# Music Visualizer

A browser-based music visualizer. Load an MP3 and let the whole screen slowly shift colour with the music, with a soft bar graph you can switch on or off. Click or drag anywhere to send ripples across the screen.

## Run

No build step or dependencies. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari), or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Use

- **Load music:** press **Choose MP3**, or drag an audio file onto the page.
- **Ripples:** click anywhere on the screen; drag to leave a trail of ripples.
- **Stained-glass Voronoi:** about 300 seed points on a jittered grid drift slowly, and every frame the screen is split into the cells closest to each one. Each cell is filled like a pane of stained glass, with dark lead lines between them, and neighbouring panes share similar colours so hues sweep across the screen. Panes near the centre follow the bass and panes near the edges follow the treble. Strong beats send waves of light through the glass, and random lead lines glow with the music. A click pushes nearby seeds away so the panes warp, and its ripple lights the glass it passes.
- **Bézier silk:** four ribbons cross the screen in different directions. Each is a bundle of 90 cubic Bézier strands whose ends are swapped, so they twist through each other like string art. Each ribbon follows one part of the spectrum, and light pulses travel along the strands.
- **Bars:** show or hide the bar graph with the **Bars** button.

| Key   | Action             |
| ----- | ------------------ |
| Space | Play / pause       |
| B     | Show / hide bars   |
| F     | Toggle fullscreen  |

The control bar hides after 3 seconds of no mouse movement while music plays; move the mouse to bring it back.

## How it works

`app.js` sends the audio through the Web Audio API `AnalyserNode` and reads the frequency data every frame. It splits the spectrum into 48 log-spaced bands and smooths everything heavily so the picture drifts instead of flickering.

- **Screen colour:** the whole screen is one colour wash. Louder music makes it brighter and richer. Bassy sound pulls the colour one way and bright, airy sound pulls it the other, while the base colour slowly turns around the colour wheel, faster when the music is fuller. Strong beats lift the brightness gently.
- **Bars:** show or hide the bar graph with the **Bars** button.

| Key   | Action             |
| ----- | ------------------ |
| Space | Play / pause       |
| B     | Show / hide bars   |
| F     | Toggle fullscreen  |

The control bar hides after 3 seconds of no mouse movement while music plays; move the mouse to bring it back.

## How it works

`app.js` sends the audio through the Web Audio API `AnalyserNode` and reads the frequency data every frame. It splits the spectrum into 48 log-spaced bands and smooths everything heavily so the picture drifts instead of flickering.

- **Colour field:** six large, soft colour clouds drift slowly across the screen. Each one listens to its own slice of the spectrum and grows and brightens with it. They are painted on a tiny offscreen canvas and stretched to full screen, which blurs them into smooth gradients.
- **Mood:** the base colour turns slowly around the colour wheel, a little faster when the music is fuller. The whole screen brightens with loudness and lifts gently on strong beats.
- **Bars:** soft, translucent bars mirrored from the centre, with bass in the middle.
- **Texture:** faint floating motes and fine film grain.
- **Ripples:** click or drag to send out rings that push the motes aside and warp the glass. They grow larger when the music is louder.
