# Twitch Slots

Chat redeems channel points for a slot machine spin. Spins are **saved**, not
played right away. When you're ready ("time to spin the slots!"), press
**Spin next** in the control panel and they play one at a time, oldest first.

While the reels spin, the chatter's name shows under the machine. When it
stops, the name turns green with a ✓ and the reward appears. Both disappear
7 seconds later.

## What you need

- Windows with [Node.js](https://nodejs.org) 22 or newer (LTS is fine)
- OBS (or any streaming app with a browser source)

## One-time setup

### 1. Create the channel point reward

In the Twitch Creator Dashboard, go to **Viewer Rewards → Channel Points →
Manage Rewards** and add a custom reward called **Spin the Slots** (or any
name, as long as it matches `rewardTitle` in `config.json`). Set the cost
you want.

### 2. Register a Twitch app (gets you a client ID)

1. Go to <https://dev.twitch.tv/console/apps> and log in.
2. **Register Your Application**:
   - Name: anything, e.g. `my-slots`
   - OAuth Redirect URL: `http://localhost:7878/auth`
   - Category: Broadcaster Suite
   - Client type: Public
3. Open the app and copy its **Client ID** into `config.json`:

```json
"twitch": {
  "clientId": "paste-it-here",
  "rewardTitle": "Spin the Slots"
}
```

### 3. Start it and connect

1. Double-click `start.cmd`. A console window opens (keep it open while
   streaming) and the control panel opens in your browser.
2. Click **Connect Twitch** → **Log in with Twitch**. It only asks for
   permission to see channel point redeems.
3. The control panel should say **Twitch: connected**. The login is
   remembered, so next time just run `start.cmd`. If Twitch ever logs you out,
   click **Connect Twitch** again.

### 4. Add the overlay in OBS

Add a **Browser** source:

- URL: `http://localhost:7878/overlay`
- Width `520`, height `420`
- Leave the background transparent (the default)

You can leave the source on all the time. The machine is invisible until you
press **Spin next**, fades in for the spin, and fades out 7 seconds after the
result. If you spin again during those 7 seconds, it stays on screen.

Tick **Control audio via OBS** in the source's settings so the slot sounds get
their own slider in the OBS audio mixer.

## Sound

The overlay ticks once for every symbol that passes, speeding up and slowing
down with the reel like a case opening. It plays a reveal chime when a reward
lands. "Better luck next time" plays no chime.

- **Volume:** add it to the overlay URL, e.g. `http://localhost:7878/overlay?volume=0.3`
  (0 to 1, default 0.6), or use the OBS mixer.
- **No sound:** `http://localhost:7878/overlay?sound=off`
- **Your own sounds:** put `tick.mp3` and/or `win.mp3` (`.ogg` and `.wav` also
  work) in the `sounds` folder, then refresh the browser source. Any file you
  leave out uses the built-in sound.
- If you open the overlay in a normal browser tab, click the page once to
  turn sound on. Browsers block sound until you click. OBS doesn't need this.

## While streaming

- Redeems pile up under **Saved spins**, and the overlay shows how many are waiting.
- **Spin next** plays the oldest saved spin. The button stays disabled until the spin finishes.
- **✕ remove** drops a saved spin (for example after a refund).
- **Add a spin by hand** is for testing, or for redeems made while the app was off.
- Saved spins are kept in `data/queue.json`, so closing the app doesn't lose them.

Rewards are **not** given out automatically. The overlay and **Recent spins**
show what each chatter won, and you hand it out yourself.

## Changing the rewards

Edit `rewards` in `config.json` and restart:

```json
{ "name": "JACKPOT: VIP for a week", "symbol": "💎", "weight": 3 }
```

- **weight** sets how likely a reward is compared to the others. With weights
  that add up to 100, a weight of 3 means about a 3% chance.
- A reward **with** a symbol lands three of that symbol.
- A reward **without** a symbol (like "Better luck next time") lands a
  mismatched row.

`spinDurationMs` sets how long the reels spin, in milliseconds.

## For developers

```
npm test     # runs the tests (node --test, no dependencies)
npm start    # same as start.cmd without opening the browser
```

- `src/queue.js`: the saved-spin queue, written to disk
- `src/slots.js`: weighted reward picking and reel symbols
- `src/display.js`: the name timing (shared by the overlay and the tests)
- `src/ticks.js`: reel easing and when each tick sound plays
- `src/twitch.js`: Twitch EventSub WebSocket listener
- `src/app.js`: the HTTP server, API and live updates (server-sent events)
- `public/`: overlay, control panel and login pages

The server only listens on `127.0.0.1`, so nobody else on the network can
reach the control panel.
