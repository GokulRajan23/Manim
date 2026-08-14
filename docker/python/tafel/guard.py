"""The AST guard (plan.md §4.8, Step 8).

Generated Python is arbitrary model output. The container is the security
boundary, but the container is expensive: starting one to discover that a scene
imports `os` wastes seconds per beat and, worse, teaches nothing the source did
not already say. This runs first and rejects on the *source*.

It is an AST walk, not a regex. `import os` inside a string, in a comment, or
spelled `__import__("os")` are three different things to a regex and one thing to
the parser — and the model gets all three wrong eventually.

Reports every violation rather than the first, so one repair round can fix them
all instead of discovering them one render at a time.

Usage: `python -m tafel.guard <file.py>` — prints JSON, exits 1 if it rejects.
"""

import ast
import json
import re
import sys

#: Only these may be imported. Anything else is a capability the scene does not need.
ALLOWED_IMPORTS = {"manim", "numpy", "np", "tafel"}

#: Names that reach the filesystem, the network, or the interpreter itself.
FORBIDDEN_NAMES = {
    "open", "eval", "exec", "compile", "__import__", "globals", "locals",
    "getattr", "setattr", "delattr", "vars", "input", "breakpoint", "exit", "quit",
}

#: Mobjects that would load an asset from disk, which no generated scene may do.
FORBIDDEN_CALLS = {"SVGMobject", "ImageMobject", "OpenGLImageMobject"}

#: A raw hex colour bypasses the palette, and with it every contrast guarantee
#: the rulebook makes (§3.5). Role names are the only way to name a colour.
HEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")

#: GROUND is the colour of the frame itself. Every contrast ratio in the rulebook
#: is measured *against* it, so drawing in it means drawing something invisible.
#: Measured: the first codegen run produced seven scenes that all passed the
#: guard and drew nothing a viewer could see, because `axis_config={"color":
#: GROUND}` is perfectly legal and completely illegible.
INVISIBLE_COLOUR = "GROUND"

#: Names exported by the palette that are NOT colours, mapped to why. FONT is the
#: typeface name "Inter", and `color=FONT` fails deep inside manim with
#: `ValueError: Color Inter not found` — four of seven beats in one run, from a
#: prompt that listed FONT alongside the colour roles. Rejecting it here turns a
#: render-time traceback into a one-line repair instruction.
NOT_A_COLOUR = {
    "FONT": "FONT is the typeface name, not a colour. Use it as Text(font=FONT).",
    INVISIBLE_COLOUR: (
        "GROUND is the frame colour; drawing in it makes the object invisible. "
        "Use KNOWN, UNKNOWN, CONSTRUCTION or RESULT."
    ),
}


class Guard(ast.NodeVisitor):
    def __init__(self):
        self.violations = []

    def reject(self, node, rule, detail):
        self.violations.append(
            {"rule": rule, "detail": detail, "line": getattr(node, "lineno", 0)}
        )

    def visit_Import(self, node):
        for alias in node.names:
            root = alias.name.split(".")[0]
            if root not in ALLOWED_IMPORTS:
                self.reject(node, "import", f"`import {alias.name}` is not allowed")
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        root = (node.module or "").split(".")[0]
        if root not in ALLOWED_IMPORTS:
            self.reject(node, "import", f"`from {node.module} import ...` is not allowed")
        self.generic_visit(node)

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load) and node.id in FORBIDDEN_NAMES:
            self.reject(node, "forbidden-name", f"`{node.id}` is not allowed")
        self.generic_visit(node)

    def visit_Attribute(self, node):
        # Dunder access is how a sandbox escape usually starts.
        if node.attr.startswith("__") and node.attr.endswith("__"):
            self.reject(node, "dunder", f"`.{node.attr}` is not allowed")
        self.generic_visit(node)

    def visit_Call(self, node):
        name = None
        if isinstance(node.func, ast.Name):
            name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            name = node.func.attr

        if name in FORBIDDEN_CALLS:
            self.reject(node, "asset-load", f"`{name}` loads an external asset")

        # One animated change at a time (rules §3). `self.play(a, b)` with two
        # animations is the single most common way a generated scene breaks the
        # one-change-at-a-time rule, and it is visible right here in the AST.
        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "play"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "self"
        ):
            animations = [a for a in node.args if not isinstance(a, ast.Starred)]
            if len(animations) > 1:
                self.reject(
                    node,
                    "multi-animation",
                    f"`self.play(...)` runs {len(animations)} animations at once; "
                    "use one call per change, or wrap them in AnimationGroup deliberately",
                )
        self.generic_visit(node)

    def visit_keyword(self, node):
        # `color=GROUND` and `axis_config={"color": GROUND}` both land here.
        if node.arg in ("color", "stroke_color", "fill_color", "background_stroke_color"):
            if isinstance(node.value, ast.Name) and node.value.id in NOT_A_COLOUR:
                self.reject(node, "not-a-colour", NOT_A_COLOUR[node.value.id])
        self.generic_visit(node)

    def visit_Dict(self, node):
        for key, value in zip(node.keys, node.values):
            named_colour = (
                isinstance(key, ast.Constant)
                and key.value in ("color", "stroke_color", "fill_color")
                and isinstance(value, ast.Name)
                and value.id in NOT_A_COLOUR
            )
            if named_colour:
                self.reject(node, "not-a-colour", NOT_A_COLOUR[value.id])
        self.generic_visit(node)

    def visit_Constant(self, node):
        if isinstance(node.value, str) and HEX.search(node.value):
            self.reject(
                node,
                "raw-hex",
                f'"{node.value}" is a raw colour; use a role name from tafel.palettes',
            )
        self.generic_visit(node)


def check(source, require_class="Beat"):
    """Return a list of violations. Empty means the source may be rendered."""
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        return [{"rule": "syntax", "detail": str(error), "line": error.lineno or 0}]

    guard = Guard()
    guard.visit(tree)

    # The renderer asks manim for a scene by name; if it is not defined here the
    # render fails with "there are no scenes inside that module", which is a
    # confusing way to say the class is missing.
    classes = {n.name for n in ast.walk(tree) if isinstance(n, ast.ClassDef)}
    if require_class and require_class not in classes:
        guard.violations.append(
            {
                "rule": "missing-class",
                "detail": f"no `class {require_class}` is defined in this file",
                "line": 0,
            }
        )

    return guard.violations


if __name__ == "__main__":
    with open(sys.argv[1]) as handle:
        found = check(handle.read())
    print(json.dumps(found))
    sys.exit(1 if found else 0)
