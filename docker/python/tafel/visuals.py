"""Mathematical diagrams, one per topic (plan.md §5.2, §6).

Hand-written and deterministic. These are the components that make the rules
*structural* rather than checked: colours are addressed by role, so a diagram
cannot use a colour the rulebook has not assigned a meaning to, and each builder
returns a plain `VGroup` the beat scene positions and animates.

Each builder takes an `emphasis` in 0..1 — how far through the explanation this
beat is — and returns a group whose later parts are only present once the
explanation has reached them. That is what lets one diagram develop across the
seven beats instead of appearing whole in beat one and then sitting there.
"""

from manim import *

from tafel.palettes import mathematics as P

_INK = "#FBFBFE"


def _label(text, size=20, color=_INK):
    return Text(text, font=P.FONT, font_size=size, color=color)


def slope(emphasis=1.0):
    """y = mx + b: axes, a line, and the rise-over-run triangle that defines m."""
    axes = Axes(
        x_range=[0, 6, 1],
        y_range=[0, 6, 1],
        x_length=5.2,
        y_length=3.4,
        axis_config={"color": P.CONSTRUCTION, "stroke_width": 2, "include_ticks": False},
    )
    group = VGroup(axes)

    # The line itself: y = 0.75x + 1.
    line = axes.plot(lambda x: 0.75 * x + 1, x_range=[0, 5.5], color=P.KNOWN, stroke_width=4)
    group.add(line)

    if emphasis >= 0.35:
        # Rise and run, drawn as the two legs of the defining triangle.
        p1, p2 = axes.c2p(1, 1.75), axes.c2p(4, 4.0)
        run = Line(p1, axes.c2p(4, 1.75), color=P.CONSTRUCTION, stroke_width=3)
        rise = Line(axes.c2p(4, 1.75), p2, color=P.UNKNOWN, stroke_width=3)
        group.add(run, rise)
        group.add(_label("run", 18, P.CONSTRUCTION).next_to(run, DOWN, buff=0.15))
        group.add(_label("rise", 18, P.UNKNOWN).next_to(rise, RIGHT, buff=0.15))

    if emphasis >= 0.7:
        group.add(
            MathTex(r"m = \frac{\text{rise}}{\text{run}}", color=P.RESULT, font_size=32)
            .next_to(axes, RIGHT, buff=0.5)
        )

    return group


def pythagoras(emphasis=1.0):
    """A right triangle with the squares actually built on its three sides.

    Every square is a Polygon on computed corners rather than a Square placed
    with `next_to`: `next_to` aligns bounding boxes, which leaves the squares
    beside the triangle instead of on its sides, and puts the hypotenuse square —
    the entire claim — nowhere near the hypotenuse.
    """
    a, b = 1.6, 2.1
    o = ORIGIN
    corner = o + RIGHT * b       # along the horizontal leg
    top = o + UP * a             # along the vertical leg

    group = VGroup(Polygon(o, corner, top, color=P.KNOWN, stroke_width=5))
    group.add(RightAngle(Line(o, corner), Line(o, top), length=0.25, color=P.CONSTRUCTION))

    if emphasis >= 0.3:
        # On the legs: squares hang below and to the left, away from the triangle.
        sq_b = Polygon(o, corner, corner + DOWN * b, o + DOWN * b,
                       color=P.CONSTRUCTION, fill_opacity=0.22, stroke_width=2)
        sq_a = Polygon(o, top, top + LEFT * a, o + LEFT * a,
                       color=P.CONSTRUCTION, fill_opacity=0.22, stroke_width=2)
        group.add(sq_b, sq_a)
        group.add(MathTex("b^2", color=_INK, font_size=26).move_to(sq_b))
        group.add(MathTex("a^2", color=_INK, font_size=26).move_to(sq_a))

    if emphasis >= 0.65:
        # On the hypotenuse: rotate the side vector by -90° so the square is built
        # on the far side of it, away from the triangle.
        v = top - corner
        perp = np.array([v[1], -v[0], 0.0])
        sq_c = Polygon(corner, top, top + perp, corner + perp,
                       color=P.RESULT, fill_opacity=0.28, stroke_width=2)
        group.add(sq_c)
        group.add(MathTex("c^2", color=_INK, font_size=26).move_to(sq_c))

    return group.move_to(ORIGIN)


def parabola(emphasis=1.0):
    """y = ax²: one curve, then the family, so `a` is visibly a parameter."""
    axes = Axes(
        x_range=[-3, 3, 1],
        y_range=[0, 5, 1],
        x_length=5.0,
        y_length=3.2,
        axis_config={"color": P.CONSTRUCTION, "stroke_width": 2, "include_ticks": False},
    )
    group = VGroup(axes)
    group.add(axes.plot(lambda x: x**2, x_range=[-2.2, 2.2], color=P.KNOWN, stroke_width=4))

    if emphasis >= 0.4:
        # Narrower and wider, so the parameter is seen varying rather than described.
        group.add(axes.plot(lambda x: 2.5 * x**2, x_range=[-1.4, 1.4], color=P.UNKNOWN, stroke_width=3))
        group.add(axes.plot(lambda x: 0.4 * x**2, x_range=[-3, 3], color=P.CONSTRUCTION, stroke_width=3))

    if emphasis >= 0.75:
        group.add(
            VGroup(
                MathTex("a > 1", color=P.UNKNOWN, font_size=24),
                MathTex("a = 1", color=P.KNOWN, font_size=24),
                MathTex("a < 1", color=P.CONSTRUCTION, font_size=24),
            )
            .arrange(DOWN, aligned_edge=LEFT, buff=0.22)
            .next_to(axes, RIGHT, buff=0.4)
        )

    return group


def percent(emphasis=1.0):
    """The same percentage of two different wholes, as two bars to compare."""
    def bar(width, label, share):
        whole = Rectangle(
            width=width, height=0.6, color=P.CONSTRUCTION, stroke_width=2, fill_opacity=0.15
        )
        part = Rectangle(
            width=width * share, height=0.6, color=P.UNKNOWN, stroke_width=0, fill_opacity=0.9
        )
        part.align_to(whole, LEFT)
        return VGroup(whole, part, _label(label, 18).next_to(whole, LEFT, buff=0.3))

    small = bar(2.0, "50", 0.2)
    large = bar(5.0, "200", 0.2)
    group = VGroup(small, large).arrange(DOWN, buff=0.9, aligned_edge=LEFT)

    if emphasis >= 0.5:
        # Same 20%, visibly different amounts — the misconception, made visual.
        group.add(_label("10", 20, P.UNKNOWN).next_to(small, RIGHT, buff=0.3))
        group.add(_label("40", 20, P.UNKNOWN).next_to(large, RIGHT, buff=0.3))

    if emphasis >= 0.75:
        group.add(
            MathTex(r"20\%", color=P.RESULT, font_size=30).next_to(group, UP, buff=0.4)
        )

    return group


#: Chosen per lesson by topic id, and per beat by name from the storyboard.
BUILDERS = {
    "slope": slope,
    "pythagoras": pythagoras,
    "parabola": parabola,
    "percent": percent,
}


def build(name, emphasis=1.0):
    """The diagram for `name`, or None when a beat is deliberately text-only."""
    builder = BUILDERS.get(name)
    return builder(emphasis) if builder else None
