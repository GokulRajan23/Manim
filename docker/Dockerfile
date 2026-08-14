# The render container. Every shell-based stage of the pipeline runs in here.
#
# The host cannot do this work: it has a Python version Manim CE does not support
# and neither ffmpeg nor ffprobe (plan.md §4.12). This image is also the security
# boundary — generated Python is arbitrary model output, and it is executed with
# `--network none` and only the job directory mounted.
#
# The stock manimcommunity image already provides Manim CE, a working TeX Live
# (pdflatex + dvisvgm, so MathTex renders), PyAV and the OpenGL stack. Two things
# it does not provide are added here.
FROM manimcommunity/manim:stable

USER root

# 1. ffmpeg/ffprobe. Manim itself encodes through PyAV and needs neither, but the
#    pipeline does: every duration in the project is an ffprobe measurement
#    (§4.11), and assembly muxes, concats, tpads and trims with ffmpeg (Step 9).
#
# 2. Inter. `Text(font="Inter")` silently falls back to DejaVu Sans if the font
#    is absent — a failure that looks like success in every frame it touches
#    (§3.4). Debian's fonts-inter is Inter 4.1, so the TTFs come from the distro
#    rather than being vendored into the repo; fc-cache is what actually makes
#    them resolvable by name.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ffmpeg \
      fonts-inter \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*

# Generated scenes import the `tafel` support package (§5.2), which is copied
# into the job directory per render rather than baked in — its palette module is
# regenerated from the rules YAML by `npm run gen:theme`, and an image rebuild
# per palette edit would be a slow way to change a colour. Manim puts the *scene
# file's* directory on sys.path, not the working directory, so /work needs to be
# stated explicitly for `from tafel.palette import ...` to resolve.
ENV PYTHONPATH=/work

USER manimuser
