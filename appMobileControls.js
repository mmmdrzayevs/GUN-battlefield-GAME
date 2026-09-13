/*
    Battlefield - Mobile / Touch Controls
    - Builds virtual controls entirely in JS/DOM, and drives them straight into the engine's
      existing keyboard input array (inputData[0][keyCode]) with the exact same shape a real
      keydown/keyup produces. Every gameplay system (movement, jump, shoot, grenade, dash,
      sprint, reload, weapon switching) already reads from that same array via
      keyIsDown()/keyWasPressed(), so nothing in appCharacters.js/appObjects.js needs to
      change at all - the game can't tell a virtual button press from a real key press.
    - Left stick: left/right movement only. Right side: two dedicated buttons instead of a
      stick - JUMP (up) and DOWN (down through platforms/ladders).
    - Only shown on touch-primary devices (pointer:coarse), and only during actual gameplay
      (hidden automatically whenever any menu/overlay is open, by hooking pauseGame/resumeGame
      - loaded after appUI.js so those exist).
    - The built-in engine touch-to-mouse relay (enableTouchInput) is deliberately left off:
      this game's shooting direction is driven by facing, not mouse position, so that relay
      would only risk misfiring a "shot" every time the player taps a control. These controls
      talk to the keyboard input array directly instead and never touch mouse state.
*/

'use strict';

// pointer:coarse reflects the device's *primary* pointer type and is the reliable signal
// here - 'ontouchstart' in window is deliberately not used as a fallback since it's present
// on many real desktop/hybrid browsers regardless of actual touch capability, which would
// show these controls to mouse-and-keyboard players
const isTouchDevice = matchMedia('(pointer: coarse)').matches;

// defensive, applies to every device: if the browser can't actually create a WebGL context -
// blocked by privacy/shield settings, a driver issue, or a genuine device limitation - fall
// back to the engine's own existing 2D canvas rendering path (engineWebGL.js/engineDraw.js
// already fully support glEnable=0) instead of leaving the game stuck on a black screen with
// nothing ever rendering. Must run before app.js's engineInit() call leads to glInit() firing
// (inside the async tileImage.onload), which is guaranteed here since this is synchronous
// top-level code running earlier in the page.
(function checkWebglSupport()
{
    try
    {
        const testCanvas = document.createElement('canvas');
        const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
        if (!gl)
            glEnable = 0;
        else
            gl.getExtension('WEBGL_lose_context') && gl.getExtension('WEBGL_lose_context').loseContext();
    }
    catch (e)
    {
        glEnable = 0;
    }
})();

// key codes matching the existing keyboard bindings (see appCharacters.js/appObjects.js) -
// duplicated here rather than imported so this file has zero dependency on load order for
// these constants; they're just the game's existing hotkeys
const KEY_UP = 38, KEY_DOWN = 40, KEY_LEFT = 37, KEY_RIGHT = 39; // also W/A/S/D via remapKeyCode
const KEY_SHOOT = 90;    // Z
const KEY_GRENADE = 67;  // C
const KEY_DASH = 88;     // X
const KEY_SPRINT = 16;   // Shift
const KEY_RELOAD = 76;   // L
const KEY_WEAPON = { pistol: 71, shotgun: 72, rifle: 74, heavy: 75 }; // G/H/J/K

// some phones report a landscape CSS viewport wider than the engine's default 1920x1200 cap
// (engine/engine.js: mainCanvas.width = min(innerWidth, maxWidth)), which leaves black bars
// down the sides instead of filling the screen. Raised here for touch devices only - desktop
// keeps the exact original cap. (maxWidth/maxHeight were changed from const to let in
// engine.js specifically so this can override them.)
if (isTouchDevice)
{
    maxWidth = 4096;
    maxHeight = 4096;
}

// ---------------------------------------------------------------------------------------
// low-level helpers: synthesize a key down/up exactly like onkeydown/onkeyup in
// engineInput.js do, so keyIsDown/keyWasPressed/keyWasReleased all behave identically
// whether the input came from a real key or a virtual button. Every code currently held down
// by a touch is tracked in activeTouchKeys so it can be force-released as a safety net (see
// releaseAllTouchKeys below) if a touchend/touchcancel is ever lost - e.g. the OS swallows it
// for an edge-swipe-back gesture, or the tab loses focus mid-press.
const activeTouchKeys = new Set();

function touchKeyDown(code)
{
    activeTouchKeys.add(code);
    if (!inputData[0][code] || !inputData[0][code].d)
        inputData[0][code] = { d: hadInput = 1, p: 1 };
}
function touchKeyUp(code)
{
    activeTouchKeys.delete(code);
    if (inputData[0][code])
        inputData[0][code].d = 0, inputData[0][code].r = 1;
}

// every button/stick registers a reset() callback here when it's built. Forcing the
// underlying key up (touchKeyUp) is only half the job: each control also tracks its own
// currently-owning touch identifier internally so it can tell its "my touch ended" apart
// from someone else's finger. If only the key were reset, a control that got force-released
// here would still believe its old (now-gone) touch is active and silently ignore every new
// touch on it forever after - exactly the kind of "this button stopped working" bug this
// registry exists to prevent.
const _controlResets = [];
function registerControlReset(reset) { _controlResets.push(reset); }

function releaseAllTouchKeys()
{
    for (const reset of _controlResets)
        reset();
    for (const code of [...activeTouchKeys])
        touchKeyUp(code);
}
// safety net: nothing should stay "pressed" (or stuck unresponsive) once the tab is
// backgrounded, loses focus, or the controls are hidden mid-press
addEventListener('blur', releaseAllTouchKeys);
document.addEventListener('visibilitychange', () => document.visibilityState == 'hidden' && releaseAllTouchKeys());

// state referenced by buttons built during the initial buildMobileControls() call below -
// declared here (rather than near the functions that use them further down) so they're
// already initialized by the time that synchronous call reaches them
const weaponButtons = {};  // keyCode -> button element, for the currently-equipped highlight
let mapViewActive = 0;     // scout/map-view toggle state

if (isTouchDevice)
{
    buildMobileControls();
}

function buildMobileControls()
{
    const root = document.createElement('div');
    root.id = 'mobileControls';
    root.className = 'mobile-controls';
    document.body.appendChild(root);

    buildMoveJoystick(root);
    buildJumpDownButtons(root);
    buildActionButtons(root);
    buildWeaponSelect(root);
    buildPauseButton(root);
    buildUtilityButtons(root);
    buildLandscapeHint();
    addTouchControlsLegend();

    // hidden by default; shown only while actually playing (see pauseGame/resumeGame hooks
    // below, loaded after appUI.js so those functions already exist)
    setMobileControlsVisible(false);
}

// appends a short legend to the existing Controls panel (index.html) so touch players see
// what their on-screen buttons do, right alongside the keyboard/mouse bindings
function addTouchControlsLegend()
{
    const list = document.querySelector('#controlsPanel .ui-controls-list');
    if (!list)
        return;
    const rows =
    [
        ['Move Left/Right', 'Left Stick'],
        ['Jump', 'Blue button'],
        ['Move Down / Drop', 'Red button'],
        ['Shoot', 'FIRE'],
        ['Throw Grenade', 'NADE'],
        ['Dash / Dodge', 'DASH'],
        ['Sprint (hold + move)', 'SPRINT'],
        ['Reload', 'RELD'],
        ['Select Weapon', '1 / 2 / 3 / 4'],
        ['Pause', '\u2759\u2759 (top-left)'],
        ['Fullscreen', '\u26f6 (top-left)'],
        ['Scout / see enemies (tap to toggle)', 'MAP (top-left)'],
    ];
    const heading = document.createElement('div');
    heading.style.cssText = 'margin:10px 0 4px;color:#ffb84a;font-size:11px;letter-spacing:1px;';
    heading.textContent = 'TOUCH CONTROLS';
    list.appendChild(heading);
    for (const [action, control] of rows)
    {
        const row = document.createElement('div');
        row.innerHTML = '<span>' + action + '</span><span>' + control + '</span>';
        list.appendChild(row);
    }
}

function setMobileControlsVisible(visible)
{
    const root = document.getElementById('mobileControls');
    if (root)
        root.classList.toggle('mobile-controls-visible', visible);
    if (!visible)
    {
        releaseAllTouchKeys(); // don't leave movement/actions stuck on while a menu is open
        mapViewActive = 0;
        const mapBtn = document.querySelector('.mc-btn-mapview');
        mapBtn && mapBtn.classList.remove('mc-mapview-active');
    }
}

///////////////////////////////////////////////////////////////////////////////
// shared low-level touch handling for every button in this file. One robust implementation
// used everywhere (movement stick excepted, which needs continuous drag tracking) avoids the
// bugs that come from several slightly-different one-off touch handlers: every button here
// behaves identically - press fires onDown, release (touchend OR touchcancel) fires onUp -
// and touch events target-lock to the element a touch started on for their whole gesture, so
// per-element listeners are all that's needed for correct multi-touch behavior.
function createTouchButton(className, label, onDown, onUp)
{
    const btn = document.createElement('div');
    btn.className = 'mc-button ' + className;
    btn.textContent = label;

    let touchId = null;

    btn.addEventListener('touchstart', e =>
    {
        e.preventDefault();
        e.stopPropagation();
        if (touchId !== null)
            return; // already pressed by another finger, ignore additional touches
        touchId = e.changedTouches[0].identifier;
        btn.classList.add('mc-button-active');
        onDown();
    }, { passive: false });

    function release(e)
    {
        for (const t of e.changedTouches)
            if (t.identifier === touchId)
            {
                touchId = null;
                btn.classList.remove('mc-button-active');
                onUp && onUp();
            }
    }
    btn.addEventListener('touchend', release);
    btn.addEventListener('touchcancel', release);

    registerControlReset(() =>
    {
        if (touchId === null)
            return;
        touchId = null;
        btn.classList.remove('mc-button-active');
        onUp && onUp();
    });

    return btn;
}

// most buttons just drive one key code down/up - the tap-vs-hold distinction the game cares
// about (keyIsDown vs keyWasPressed) is entirely up to how the game reads that key, not how
// this button behaves, so hold-style and tap-style buttons use the exact same code here
function makeKeyButton(className, label, keyCode)
{
    return createTouchButton(className, label, () => touchKeyDown(keyCode), () => touchKeyUp(keyCode));
}

///////////////////////////////////////////////////////////////////////////////
// left stick - horizontal movement only (unchanged from before)
function buildMoveJoystick(root)
{
    const base = document.createElement('div');
    base.className = 'mc-joystick-base mc-joystick-left';
    const stick = document.createElement('div');
    stick.className = 'mc-joystick-stick';
    base.appendChild(stick);
    root.appendChild(base);

    let touchId = null;
    let originX = 0;
    let rightActive = 0, leftActive = 0;
    const deadzone = 10, maxRadius = 44;

    function setRight(isActive)
    {
        if (rightActive == isActive) return;
        rightActive = isActive;
        isActive ? touchKeyDown(KEY_RIGHT) : touchKeyUp(KEY_RIGHT);
    }
    function setLeft(isActive)
    {
        if (leftActive == isActive) return;
        leftActive = isActive;
        isActive ? touchKeyDown(KEY_LEFT) : touchKeyUp(KEY_LEFT);
    }
    function updateFromDelta(dx)
    {
        setRight(dx > deadzone);
        setLeft(dx < -deadzone);
        const clamped = Math.max(-maxRadius, Math.min(maxRadius, dx));
        stick.style.transform = `translate(${clamped}px, 0)`;
    }
    function releaseAll()
    {
        setRight(0);
        setLeft(0);
        stick.style.transform = '';
    }

    base.addEventListener('touchstart', e =>
    {
        if (touchId !== null)
            return;
        e.preventDefault();
        const t = e.changedTouches[0];
        touchId = t.identifier;
        originX = base.getBoundingClientRect().left + base.getBoundingClientRect().width / 2;
        updateFromDelta(t.clientX - originX);
    }, { passive: false });

    base.addEventListener('touchmove', e =>
    {
        for (const t of e.changedTouches)
            if (t.identifier === touchId)
            {
                e.preventDefault();
                updateFromDelta(t.clientX - originX);
            }
    }, { passive: false });

    function onTouchEnd(e)
    {
        for (const t of e.changedTouches)
            if (t.identifier === touchId)
            {
                touchId = null;
                releaseAll();
            }
    }
    base.addEventListener('touchend', onTouchEnd);
    base.addEventListener('touchcancel', onTouchEnd);

    registerControlReset(() =>
    {
        if (touchId === null)
            return;
        touchId = null;
        releaseAll();
    });
}

///////////////////////////////////////////////////////////////////////////////
// right side: two dedicated buttons instead of a stick - JUMP (blue, rightmost) and DOWN
// (red, directly to its left)
function buildJumpDownButtons(root)
{
    root.appendChild(makeKeyButton('mc-btn-down', 'DOWN', KEY_DOWN));
    root.appendChild(makeKeyButton('mc-btn-jump', 'JUMP', KEY_UP));
}

///////////////////////////////////////////////////////////////////////////////
// action buttons - FIRE/NADE/DASH/SPRINT/RELD
function buildActionButtons(root)
{
    const cluster = document.createElement('div');
    cluster.className = 'mc-action-cluster';
    cluster.appendChild(makeKeyButton('mc-btn-shoot', 'FIRE', KEY_SHOOT));
    cluster.appendChild(makeKeyButton('mc-btn-grenade', 'NADE', KEY_GRENADE));
    cluster.appendChild(makeKeyButton('mc-btn-dash', 'DASH', KEY_DASH));
    cluster.appendChild(makeKeyButton('mc-btn-sprint', 'SPRINT', KEY_SPRINT));
    cluster.appendChild(makeKeyButton('mc-btn-reload', 'RELD', KEY_RELOAD));
    root.appendChild(cluster);
}

function buildWeaponSelect(root)
{
    const row = document.createElement('div');
    row.className = 'mc-weapon-row';
    const defs =
    [
        [KEY_WEAPON.pistol, '1', 'mc-weapon-pistol'],
        [KEY_WEAPON.shotgun, '2', 'mc-weapon-shotgun'],
        [KEY_WEAPON.rifle, '3', 'mc-weapon-rifle'],
        [KEY_WEAPON.heavy, '4', 'mc-weapon-heavy'],
    ];
    for (const [keyCode, label, themeClass] of defs)
    {
        const btn = makeKeyButton('mc-btn-weapon ' + themeClass, label, keyCode);
        weaponButtons[keyCode] = btn;
        row.appendChild(btn);
    }
    root.appendChild(row);
}

function buildPauseButton(root)
{
    const btn = createTouchButton('mc-btn-pause', '\u2759\u2759', () =>
    {
        hadInput = 1;
        openPauseMenu();
    });
    root.appendChild(btn);
}

///////////////////////////////////////////////////////////////////////////////
// utility row: fullscreen toggle + "scout" map-view button (top-left, under the weapon row)
function buildUtilityButtons(root)
{
    const fsSupported = document.documentElement.requestFullscreen ||
        document.documentElement.webkitRequestFullscreen;
    if (fsSupported)
        root.appendChild(buildFullscreenButton());

    root.appendChild(buildMapViewButton());
}

// toggles the browser's Fullscreen API - hides the address bar/status bar so the game
// actually gets the screen space the "canvas doesn't fit" fix earlier relies on. Only added
// to the page at all if the browser supports it (checked in buildUtilityButtons), so there's
// never a dead button that does nothing.
function buildFullscreenButton()
{
    const btn = createTouchButton('mc-btn-fullscreen', '\u26f6', () =>
    {
        if (document.fullscreenElement || document.webkitFullscreenElement)
        {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        }
        else
        {
            const el = document.documentElement;
            (el.requestFullscreen || el.webkitRequestFullscreen).call(el).catch(() => {});
        }
    });
    return btn;
}

// tap-to-toggle "scout" view: zooms the camera out (mirroring the desktop mouse-wheel zoom
// debug feature - see cameraScale handling in app.js) so the player can check enemy
// positions across more of the level, tap again to return to normal. Toggle rather than
// hold, since holding it down would tie up a finger needed for movement/shooting at the same
// time. Distinct pill shape + cyan gradient + a pulsing glow while active so it visually
// stands out from every other (circular, dark) button and it's always clear it's still on.
function buildMapViewButton()
{
    // toggles on tap rather than using createTouchButton's press/release callbacks, since
    // this is a persistent on/off state rather than "held down" - setMobileControlsVisible
    // turns it back off whenever a menu opens, so it never gets stuck on across a pause
    const btn = createTouchButton('mc-btn-mapview', '\u25c9 MAP', () =>
    {
        mapViewActive = !mapViewActive;
        btn.classList.toggle('mc-mapview-active', mapViewActive);
    });
    return btn;
}

const mapViewZoomedScale = defaultCameraScale * .38; // more of the level visible while active
const weaponTypeToKey = [KEY_WEAPON.pistol, KEY_WEAPON.shotgun, KEY_WEAPON.rifle, KEY_WEAPON.heavy];
let lastHighlightedWeaponKey = null;

function pollMobileControls()
{
    if (!isTouchDevice)
        return;

    if (typeof cameraScale == 'number')
    {
        const target = mapViewActive ? mapViewZoomedScale : defaultCameraScale;
        // ease toward the target scale each tick, same feel as the mouse-wheel zoom
        cameraScale = lerp(.12, target, cameraScale);
    }

    // highlight whichever weapon button matches the player's currently-equipped weapon
    const player = typeof players != 'undefined' && players[0];
    const weaponKey = player && player.weapon ? weaponTypeToKey[player.weapon.weaponType] : null;
    if (weaponKey !== lastHighlightedWeaponKey)
    {
        if (weaponButtons[lastHighlightedWeaponKey])
            weaponButtons[lastHighlightedWeaponKey].classList.remove('mc-weapon-equipped');
        if (weaponButtons[weaponKey])
            weaponButtons[weaponKey].classList.add('mc-weapon-equipped');
        lastHighlightedWeaponKey = weaponKey;
    }
}

///////////////////////////////////////////////////////////////////////////////
// one-time "try landscape" nudge for touch players who start in portrait - non-blocking,
// dismisses itself, and only ever shows once (persisted)
function buildLandscapeHint()
{
    if (gameSave.preferences.seenLandscapeHint)
        return;
    if (innerWidth >= innerHeight)
        return; // already landscape, nothing to suggest

    const hint = document.createElement('div');
    hint.className = 'mc-landscape-hint';
    hint.textContent = '\u21bb Rotate your device for the best experience';
    document.body.appendChild(hint);

    const dismiss = () =>
    {
        hint.remove();
        gameSave.preferences.seenLandscapeHint = 1;
        saveGame();
    };
    hint.addEventListener('touchstart', dismiss, { passive: true });
    setTimeout(dismiss, 4000);
}

///////////////////////////////////////////////////////////////////////////////
// show/hide the whole control layer exactly when the game itself is actually running -
// pauseGame/resumeGame (declared in appUI.js, already loaded) are called from every single
// place the game pauses or resumes (menus, settings, game over, victory, level start), so
// hooking just these two covers every case
if (isTouchDevice)
{
    const _pauseGame = pauseGame;
    pauseGame = function() { _pauseGame(); setMobileControlsVisible(false); };

    const _resumeGame = resumeGame;
    resumeGame = function() { _resumeGame(); setMobileControlsVisible(true); };
}
