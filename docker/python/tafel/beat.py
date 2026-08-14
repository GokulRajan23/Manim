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

#: The frame is 14.2 x 8 units. These carve it into three bands that never
#: overlap: the header (title + rule), the stage (diagrams), and the footer
#: (keywords). Generated code draws into the stage and nothing else, so a scene
#: cannot land on top of text it did not know was there.
STAGE_TOP = 2.15
STAGE_BOTTOM = -2.30
STAGE_WIDTH = 12.0
FOOTER_Y = -3.15


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
            diagram.scale_to_fit_height(STAGE_TOP - STAGE_BOTTOM).move_to(
                [0, (STAGE_TOP + STAGE_BOTTOM) / 2, 0]
            )

        # On-screen text is keywords, never the narration read back (rules §4).
        # They live in the footer band, at a fixed y, whether or not there is a
        # diagram. Previously they sat directly under the rule — in the middle of
        # the frame — and generated scenes, which centre on ORIGIN, drew straight
        # through them.
        lines = [str(line) for line in self.LINES][:3]
        body = VGroup(*[Text(line, font=P.FONT, font_size=22, color=_INK) for line in lines])
        if lines:
            body.arrange(RIGHT, buff=0.7)
            if body.width > STAGE_WIDTH:
                body.scale_to_fit_width(STAGE_WIDTH)
            body.move_to([0, FOOTER_Y, 0])

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
        before = set(id(m) for m in self.mobjects)
        self.body()
        self._fit_to_stage(before)

        # Exact-length by construction: whatever the animations cost, the hold
        # makes the total equal DURATION. Reconciliation (§4.11) then has nothing
        # to correct, because the scene was never free to drift.
        elapsed = getattr(self.renderer, "time", None)
        used = elapsed if isinstance(elapsed, (int, float)) else spent
        self.wait(max(self.DURATION - used, 0.1))

    def body(self):
        """Override to draw the mathematics. The base handles timing."""
        return None

    def _fit_to_stage(self, before_ids):
        """Move anything `body()` drew into the stage band, if it strayed out.

        The contract tells generated code the exact rectangle it owns, but a
        contract the renderer does not enforce is a suggestion. This is the
        enforcement: whatever `body()` added is grouped and, only if it breaks
        the band, scaled and shifted back inside it. A brief reflow is a far
        better outcome than a caption sitting under an axis for the whole beat.
        """
        added = [m for m in self.mobjects if id(m) not in before_ids]
        if not added:
            return

        group = VGroup(*added)
        if group.width <= 0 or group.height <= 0:
            return

        height = STAGE_TOP - STAGE_BOTTOM
        too_tall = group.height > height
        too_wide = group.width > STAGE_WIDTH
        strays = group.get_top()[1] > STAGE_TOP or group.get_bottom()[1] < STAGE_BOTTOM

        if not (too_tall or too_wide or strays):
            return

        if too_tall or too_wide:
            group.scale(min(height / group.height, STAGE_WIDTH / group.width))
        group.move_to([group.get_center()[0], (STAGE_TOP + STAGE_BOTTOM) / 2, 0])
