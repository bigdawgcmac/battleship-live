# Battleship Live

Classic Battleship for two players on two computers, played live in the browser.

## How to play

1. Open the game page, type your captain name, and click **Create a new game**.
2. Send the invite: **Email invite** opens your mail app with the link filled in. **Copy invite message** works for Gmail, Outlook web or a text. **Copy** copies just the link.
3. Place your five ships (Carrier 5, Battleship 4, Cruiser 3, Submarine 3, Destroyer 2).
   Click a ship, then click the grid. Press **R** or right-click to rotate. Click a placed ship to move it, or use **Random**.
4. Click **Ready for battle**. The battle starts when both captains are ready.
5. Take turns firing at **Enemy waters**. The first captain to sink all five enemy ships wins. Click **Rematch** to play again.

Your opponent only needs the link. They don't need an account or any installs.

## Good to know

- **Each computer is its own board.** Your ships never leave your computer. When your opponent fires, your computer decides hit or miss and sends back only the result.
- **Keep the tab open.** If either player refreshes or briefly loses connection, the game resumes where it left off. To come back later, reopen the same link in the same browser.
- **Sound:** synthesized effects for launches, splashes, explosions, sinkings and victory. Use the speaker button to mute.
- **Connection:** players connect directly, browser to browser (WebRTC through PeerJS). If a network blocks that, the game switches to a public relay on its own. The status pill shows "Connected (relay)" when that happens.

## Files

- `index.html`: page layout
- `styles.css`: naval theme
- `js/game.js`: rules, ship placement, battle flow, rendering
- `js/net.js`: two-computer networking (direct connection, plus relay fallback)
- `js/sound.js`: sound effects (Web Audio, no audio files)

To test both sides on one computer, open the invite link in a second browser tab or window.
