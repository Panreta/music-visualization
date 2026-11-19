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
There are four backgrounds (scenes):

**Scene 1: stained glass**

- **Stained-glass Voronoi:** about 300 seed points on a jittered grid drift slowly, and every frame the screen is split into the cells closest to each one. Each cell is filled like a pane of stained glass, with dark lead lines between them, and neighbouring panes share similar colours so hues sweep across the screen. Panes near the centre follow the bass and panes near the edges follow the treble. Strong beats send waves of light through the glass, and random lead lines glow with the music. A click pushes nearby seeds away so the panes warp, and its ripple lights the glass it passes.
- **Bézier silk:** four ribbons cross the screen in different directions. Each is a bundle of 90 cubic Bézier strands whose ends are swapped, so they twist through each other like string art. Each ribbon follows one part of the spectrum, and light pulses travel along the strands.
- **Scene:** each page load and each new song randomly picks one of four backgrounds; press **Scene** to switch.

**Scene 2: vector field**

- A smooth, slowly changing vector field covers the screen, with a grid of arrows showing its direction. About 1,600 particles stream along it and leave fading trails that draw the flow lines. Each colour group of particles follows one part of the spectrum, and louder music makes everything flow faster. Strong beats drop swirling vortices into the field and flash the arrows; a click drops a strong swirl where you clicked.

**Scene 3: fireflies and star dust**

- Only particles: about 1,400 specks of star dust turn slowly around the centre, with nearer stars brighter and faster. Treble makes them twinkle and bass makes them pulse. Seventy fireflies drift on curving paths and blink, each glowing with its own part of the spectrum. Strong beats make groups of fireflies flash together and sometimes send a shooting star across the sky. A click lights up nearby fireflies and scatters them, and its ripple pushes the stars aside.

**Scene 4: Brownian motion**

A particle system driven by stochastic differential equations. Each time the scene appears it picks one of five models at random, and shows its name and equation in the top-left corner (press the refresh button next to it, or M, for another; the scene stays, only the equation changes). About 1,200 particles are stepped with the Euler–Maruyama method, `X += drift·dt + σ·√dt·N(0,1)`, and their fading trails draw the random paths.

| Model | Equation | Looks like |
| ----- | -------- | ---------- |
| Wiener process | dX = σ dW | random walks filling the screen |
| Ornstein–Uhlenbeck | dX = θ(μ − X) dt + σ dW | clouds pulled toward four drifting centres |
| Geometric Brownian motion (radial) | dR = μR dt + σR dW | a starburst from the centre |
| Langevin in a double-well potential | dV = −γV dt − ∇U(X) dt + σ dW | two clusters; particles hop between them when the music is loud |
| Rotating Ornstein–Uhlenbeck | dX = (−θX + ωJX) dt + σ dW | a swirling vortex |

The music sets the temperature (the noise strength σ), beats kick it up, bass and mids shape some drifts, and a click releases a burst of particles that diffuse out from that point.

**On top of every scene:**

- **Bars:** show or hide the bar graph with the **Bars** button.

| Key   | Action             |
| ----- | ------------------ |
| Space | Play / pause       |
| S     | Switch background  |
| M     | New random model (Brownian scene) |
| B     | Show / hide bars   |
| F     | Toggle fullscreen  |

The control bar hides after 3 seconds of no mouse movement while music plays; move the mouse to bring it back.

## How it works

`app.js` sends the audio through the Web Audio API `AnalyserNode` and reads the frequency data every frame. It splits the spectrum into 48 log-spaced bands and smooths everything heavily so the picture drifts instead of flickering.

- **Screen colour:** the whole screen is one colour wash. Louder music makes it brighter and richer. Bassy sound pulls the colour one way and bright, airy sound pulls it the other, while the base colour slowly turns around the colour wheel, faster when the music is fuller. Strong beats lift the brightness gently.
- **Scene:** each page load and each new song randomly picks one of four backgrounds; press **Scene** to switch.
- **Bars:** show or hide the bar graph with the **Bars** button.

| Key   | Action             |
| ----- | ------------------ |
| Space | Play / pause       |
| S     | Switch background  |
| M     | New random model (Brownian scene) |
| B     | Show / hide bars   |
| F     | Toggle fullscreen  |

The control bar hides after 3 seconds of no mouse movement while music plays; move the mouse to bring it back.

## How it works

`app.js` sends the audio through the Web Audio API `AnalyserNode` and reads the frequency data every frame. It splits the spectrum into 48 log-spaced bands and smooths everything heavily so the picture drifts instead of flickering.

- **Colour field:** six large, soft colour clouds drift slowly across the screen. Each one listens to its own slice of the spectrum and grows and brightens with it. They are painted on a tiny offscreen canvas and stretched to full screen, which blurs them into smooth gradients.
- **Mood:** the base colour turns slowly around the colour wheel, a little faster when the music is fuller. The whole screen brightens with loudness and lifts gently on strong beats.
- **Bars:** soft, translucent bars mirrored from the centre, with bass in the middle.
- **Texture:** faint floating motes and fine film grain (a static CSS layer).
- **Ripples:** click or drag to send out rings that push the motes aside, warp the glass, swirl the vector field, scatter the fireflies, or release a burst of Brownian particles. They grow larger when the music is louder.
