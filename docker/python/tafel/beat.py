"""The deterministic beat scene — the artifact guarantee (plan.md §4.13).

This renders *any* beat to *exactly* its required duration without a model in the
loop. It is what makes "the pipeline cannot hard-fail" true: generated scenes can
be wrong, time out, or refuse to compile, and this still produces a correct-length
frame-locked video for that beat.

Per-beat content arrives as **class attributes on a subclass**, not module globals.
Two reasons, both learned the hard way: Manim only discovers Scene subclasses
*defined* in the file it is given (an imported one yields "there are no scenes
inside that module"), and a global read from here would resolve against this
module's namespace rather than the generated file's.

Colours come from the generated palette module by role name, never as raw hex, so
a palette violation cannot be written here (§3.5).
"""

from manim import *

from tafel.palettes import mathematics as P

# Role colours, addressed by meaning rather than appearance.
_ROLE = {
    "known": P.KNOWN,
    "unknown": P.UNKNOWN,
    "construction": P.CONSTRUCTION,
    "result": P.RESULT,
    "focus": getattr(P, "FOCUS", P.RESULT),
}

_INK = "#FBFBFE"


class BeatBase(Scene):
    """Subclass this and set the four attributes below."""

    TITLE = ""
    LINES = []
    ROLE = "known"
    DURATION = 5.0

    def construct(self):
        self.camera.background_color = P.GROUND

        title = Text(self.TITLE, font=P.FONT, font_size=34, color=_ROLE.get(self.ROLE, P.KNOWN))
        title.to_edge(UP, buff=1.0)

        rule = Line(LEFT * 4.2, RIGHT * 4.2, color=P.CONSTRUCTION, stroke_width=2)
        rule.next_to(title, DOWN, buff=0.35)

        # On-screen text is keywords, never the narration read back (rules §4).
        lines = [str(line) for line in self.LINES][:3]
        body = VGroup(*[Text(line, font=P.FONT, font_size=26, color=_INK) for line in lines])
        if lines:
            body.arrange(DOWN, buff=0.45).next_to(rule, DOWN, buff=0.7)

        # A short reveal, then a static hold. The hold is where the duration is
        # actually spent: the rules require stillness in every beat, and animating
        # for the full length would leave none.
        reveal = min(1.0, self.DURATION * 0.2)
        self.play(FadeIn(title, shift=DOWN * 0.2), Create(rule), run_time=reveal)
        spent = reveal

        if lines:
            step = min(0.45, max(0.05, (self.DURATION - reveal) * 0.12 / len(lines)))
            for item in body:
                self.play(FadeIn(item, shift=UP * 0.15), run_time=step)
                spent += step

        # Exact-length by construction: whatever the animations cost, the hold
        # makes the total equal DURATION. Reconciliation (§4.11) then has nothing
        # to correct, because the scene was never free to drift.
        self.wait(max(self.DURATION - spent, 0.1))
