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
from tafel.visuals import build

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
    #: Which diagram this lesson draws, or "" for a text-only beat.
    VISUAL = ""
    #: 0..1 — how far through the explanation this beat sits. Drives how much
    #: of the diagram is present, so the figure builds up rather than blinking in.
    EMPHASIS = 1.0

    def construct(self):
        self.camera.background_color = P.GROUND

        title = Text(self.TITLE, font=P.FONT, font_size=34, color=_ROLE.get(self.ROLE, P.KNOWN))
        title.to_edge(UP, buff=1.0)

        rule = Line(LEFT * 4.2, RIGHT * 4.2, color=P.CONSTRUCTION, stroke_width=2)
        rule.next_to(title, DOWN, buff=0.35)

        # The diagram. EMPHASIS advances across the seven beats, so the figure
        # develops with the explanation instead of arriving complete in beat one.
        diagram = build(self.VISUAL, self.EMPHASIS)
        if diagram is not None:
            diagram.scale_to_fit_height(2.7).next_to(rule, DOWN, buff=0.45)

        # On-screen text is keywords, never the narration read back (rules §4).
        # With a diagram present the keywords sit under it and stay few, so the
        # frame keeps to the object budget the rules allow.
        lines = [str(line) for line in self.LINES][: (2 if diagram is not None else 3)]
        body = VGroup(*[Text(line, font=P.FONT, font_size=22, color=_INK) for line in lines])
        if lines:
            anchor = diagram if diagram is not None else rule
            body.arrange(RIGHT if diagram is not None else DOWN, buff=0.6)
            body.next_to(anchor, DOWN, buff=0.4)

        # A short reveal, then a static hold. The hold is where the duration is
        # actually spent: the rules require stillness in every beat, and animating
        # for the full length would leave none.
        reveal = min(1.0, self.DURATION * 0.2)
        self.play(FadeIn(title, shift=DOWN * 0.2), Create(rule), run_time=reveal)
        spent = reveal

        if diagram is not None:
            draw = min(1.4, max(0.3, (self.DURATION - reveal) * 0.22))
            self.play(FadeIn(diagram, shift=UP * 0.1), run_time=draw)
            spent += draw

        if lines:
            step = min(0.45, max(0.05, (self.DURATION - reveal) * 0.12 / len(lines)))
            for item in body:
                self.play(FadeIn(item, shift=UP * 0.15), run_time=step)
                spent += step

        # Generated content goes here, between the static frame and the hold.
        #
        # This is a hook rather than an override of `construct` on purpose. When a
        # subclass overrode `construct` and called `super().construct()` first, the
        # base had already spent the whole duration in its final wait, so every
        # generated animation ran *past* the audio and was cut off by `-shortest`
        # at mux time — scenes that rendered perfectly and showed nothing. With the
        # hold last, a generated scene cannot change how long the beat lasts.
        self.body()

        # Exact-length by construction: whatever the animations cost, the hold
        # makes the total equal DURATION. Reconciliation (§4.11) then has nothing
        # to correct, because the scene was never free to drift.
        elapsed = getattr(self.renderer, "time", None)
        used = elapsed if isinstance(elapsed, (int, float)) else spent
        self.wait(max(self.DURATION - used, 0.1))

    def body(self):
        """Override to draw the mathematics. The base handles timing."""
        return None
