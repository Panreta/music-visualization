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
- **Texture:** faint floating motes, a vignette and fine film grain.
- **Ripples:** click or drag to send out rings that push the motes aside. They grow larger when the music is louder.
