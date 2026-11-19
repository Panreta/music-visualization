# Music Visualizer

A browser-based music visualizer. Load an MP3 and watch colours, spectrum graphs and particles react to the sound. Click or drag anywhere to send ripples across the screen.

## Run

No build step or dependencies. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari), or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Use

- **Load music:** press **Choose MP3**, or drag an audio file onto the page.
- **Ripples:** click anywhere on the screen; drag to leave a trail of ripples.
- **Styles:** switch between **Radial**, **Bars** and **Terrain** in the control bar.

| Key   | Action             |
| ----- | ------------------ |
| Space | Play / pause       |
| 1 2 3 | Radial / Bars / Terrain |
| F     | Toggle fullscreen  |

The control bar hides after 3 seconds of no mouse movement while music plays; move the mouse to bring it back.

## How it works

`app.js` routes the audio element through the Web Audio API `AnalyserNode` and reads frequency and waveform data every frame. It groups the spectrum into 96 log-spaced bands and tracks bass, mid and treble energy, then uses a simple bass-jump test to detect beats. Everything is drawn on one `<canvas>`:

- The background hue drifts over time, moves faster with treble, and jumps on each beat.
- **Radial** shows mirrored spectrum bars around a pulsing core, with a waveform ring inside.
- **Bars** shows a spectrum with peak caps and reflections, with an oscilloscope line above it.
- **Terrain** shows a scrolling 3D-style ridge of recent spectrum frames.
- Click ripples are expanding rings that push nearby particles outward. They grow larger when the music is louder.
