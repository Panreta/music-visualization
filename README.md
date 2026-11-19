# Music Visualizer

A browser-based music visualizer. Load an MP3 and let the whole screen slowly shift colour with the music, with a soft bar graph you can switch on or off. Click or drag anywhere to send ripples across the screen.

## Run

No build step or dependencies. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari), or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Use

- **Load music:** press **Choose MP3**, or drag audio files onto the page (you can pick or drop several at once).
- **Library:** every song you load is saved in your browser (IndexedDB), so it is still there next time you open the page. Press **Library** (or L) to see the list with each song's length and play count; click a song to play it, or the × to remove it. When a song ends, the next one in the library plays. Nothing is uploaded: the library lives only in the browser you used.
- **Ripples:** click anywhere on the screen; drag to leave a trail of ripples.
There are five backgrounds (scenes):

**Scene 1: stained glass**

- **Stained-glass Voronoi:** about 300 seed points on a jittered grid drift slowly, and every frame the screen is split into the cells closest to each one. Each cell is filled like a pane of stained glass, with dark lead lines between them, and neighbouring panes share similar colours so hues sweep across the screen. Panes near the centre follow the bass and panes near the edges follow the treble. Strong beats send waves of light through the glass, and random lead lines glow with the music. A click pushes nearby seeds away so the panes warp, and its ripple lights the glass it passes.
- **Bézier silk:** four ribbons cross the screen in different directions. Each is a bundle of 90 cubic Bézier strands whose ends are swapped, so they twist through each other like string art. Each ribbon follows one part of the spectrum, and light pulses travel along the strands.
- **Scene:** each page load and each new song randomly picks one of five backgrounds; press **Scene** to switch.

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

**Scene 5: Game of Life**

A life-like cellular automaton on a grid that wraps around the edges. It starts from a sparse handful of cells (about a third of a 7×7 patch) in the centre of an otherwise empty screen and evolves slowly from there. The seed is the best of a dozen random tries, tested off-screen, chosen so it neither dies out at once nor floods the screen; if the pattern ever covers more than 15% of the grid, it starts again. Each time the scene appears it picks one of eight rules at random and shows its name and rule in the top-left corner; the same refresh button (or M) picks another rule and starts again from a new seed without leaving the scene. A rule `Bx/Sy` means a dead cell is born with x live neighbours and a live cell survives with y.

| Rule | Notation |
| ---- | -------- |
| Conway's Game of Life | B3/S23 |
| HighLife | B36/S23 |
| Day & Night | B3678/S34678 |
| DryLife | B37/S23 |
| Pedestrian Life | B38/S23 |
| Amoeba | B357/S1358 |
| Morley (Move) | B368/S245 |
| 2×2 | B36/S125 |

The grid steps 2 generations per second, up to 6 when the music is loud, each column takes the colour and brightness of the bar at the same distance from the centre, and dead cells fade out slowly. Strong beats (at most one every 1.5 seconds) make one to three living cells light up a neighbour, which nudges the pattern into new shapes (this also happens every 6 seconds when there are no beats). If everything dies, a new seed appears in the centre.

Click a cell to light it (or click a lit one to turn it off), and drag to light a line of cells. The grid holds still while the mouse button is down, so you can draw a shape; when you let go, your cells join the pattern. A lit cell is kept alive for 8 generations (about 4 seconds) whatever the rule says, so it can wake up its neighbours, and after that it follows the rule like any other cell. Lit cells glow white and cool to their colour, and clicks in this scene make no ripple so the cell stays visible.

**On top of every scene:**

- **Bars:** show or hide the bar graph with the **Bars** button.

| Key   | Action             |
| ----- | ------------------ |
| Space | Play / pause       |
| S     | Switch background  |
| M     | New random equation / rule (Brownian and Life scenes) |
| B     | Show / hide bars   |
| L     | Show / hide the library |
| F     | Toggle fullscreen  |

The control bar hides after 3 seconds of no mouse movement while music plays; move the mouse to bring it back.

## How it works

`app.js` sends the audio through the Web Audio API `AnalyserNode` and reads the frequency data every frame. It splits the spectrum into 48 log-spaced bands and smooths everything heavily so the picture drifts instead of flickering.

- **Screen colour:** the whole screen is one colour wash. Louder music makes it brighter and richer. Bassy sound pulls the colour one way and bright, airy sound pulls it the other, while the base colour slowly turns around the colour wheel, faster when the music is fuller. Strong beats lift the brightness gently.
- **Scene:** each page load and each new song randomly picks one of five backgrounds; press **Scene** to switch.
- **Bars:** show or hide the bar graph with the **Bars** button.

| Key   | Action             |
| ----- | ------------------ |
| Space | Play / pause       |
| S     | Switch background  |
| M     | New random equation / rule (Brownian and Life scenes) |
| B     | Show / hide bars   |
| L     | Show / hide the library |
| F     | Toggle fullscreen  |

The control bar hides after 3 seconds of no mouse movement while music plays; move the mouse to bring it back.

## How it works

`app.js` sends the audio through the Web Audio API `AnalyserNode` and reads the frequency data every frame. It splits the spectrum into 48 log-spaced bands and smooths everything heavily so the picture drifts instead of flickering.

- **Colour field:** six large, soft colour clouds drift slowly across the screen. Each one listens to its own slice of the spectrum and grows and brightens with it. They are painted on a tiny offscreen canvas and stretched to full screen, which blurs them into smooth gradients.
- **Mood:** the base colour turns slowly around the colour wheel, a little faster when the music is fuller. The whole screen brightens with loudness and lifts gently on strong beats.
- **Bars:** soft, translucent bars mirrored from the centre, with bass in the middle.
- **Texture:** faint floating motes and fine film grain (a static CSS layer).
- **Ripples:** click or drag to send out rings that push the motes aside, warp the glass, swirl the vector field, scatter the fireflies, release a burst of Brownian particles, or light Life cells. They grow larger when the music is louder.
