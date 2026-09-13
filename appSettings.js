/*
    Battlefield - Settings System
    - Reads saved settings from gameSave.settings (appSave.js) and applies them to the
      running game immediately on load
    - applySetting(key, value) is the single entry point the settings UI calls: it updates
      the live behavior AND persists it, so every setting always takes effect immediately
      and survives a refresh
    - Hooks into existing systems (particles, camera shake, damage numbers, screen effects,
      audio, weapon switching) purely by wrapping the existing functions/classes - nothing
      in the original engine/app files is changed to make this work

    Load-order note: this file loads before app.js (it has to, so the engineInit wrap below
    is in place before app.js calls engineInit()). That means anything declared *in* app.js
    itself (like lowGraphicsSettings) or later in the page (like appUI.js's functions) isn't
    available yet at the time this file's top-level code runs. Any such hook is registered
    with onDeferredInit() instead of run immediately - those all fire once, right before the
    game's own appInit(), by which point every script on the page (including appUI.js and
    appProgressionUI.js at the very end of <body>) has already executed. This is the same
    guarantee appUI.js itself already relies on for its "paused = 1 at the top of the file"
    trick, since tileImage.onload (which is what eventually calls appInit) can only fire
    after the whole document's synchronous scripts have finished running.
*/

'use strict';

// ---------------------------------------------------------------------------------------
// small deferred-init registry: lets any file (this one, appAchievements.js, etc) queue up
// a function that needs something declared later in the page, without caring about exact
// script order beyond "runs once before the game actually starts"
let _deferredInitHooks = [];
function onDeferredInit(fn) { _deferredInitHooks.push(fn); }

// ---------------------------------------------------------------------------------------
// live setting values - mirrored from gameSave.settings, this is what the rest of the game
// actually reads each frame
let screenShakeEnabled   = !!gameSave.settings.screenShake;
let particleQualityMode  = gameSave.settings.particleQuality;
let damageNumbersEnabled = !!gameSave.settings.damageNumbers;
let cameraEffectsEnabled = !!gameSave.settings.cameraEffects;
let mouseSensitivity     = gameSave.settings.mouseSensitivity;

// audio channels (sfxVolume/musicVolume/audioVolume all declared earlier, in engineAudio.js)
audioVolume = gameSave.settings.masterVolume;
sfxVolume   = gameSave.settings.sfxVolume;
musicVolume = gameSave.settings.musicVolume;

function particleQualityScale()
{
    return particleQualityMode == 'low' ? .35 : particleQualityMode == 'medium' ? .7 : 1;
}

// ---------------------------------------------------------------------------------------
// PARTICLE QUALITY - scale every particle emitter's rate at creation time by subclassing
// the engine's ParticleEmitter. Every call site across the game just does `new
// ParticleEmitter(...)`, so this one hook covers all of them without touching appEffects.js.
// (ParticleEmitter is declared in engineParticle.js, which loads well before this file.)
const _ParticleEmitterBase = ParticleEmitter;
ParticleEmitter = class extends _ParticleEmitterBase
{
    constructor(...args)
    {
        super(...args);
        this.emitRate *= particleQualityScale();
    }
};

// ---------------------------------------------------------------------------------------
// SCREEN SHAKE - wrap shakeCamera() (declared in appEffects.js, already loaded) so a
// disabled toggle simply never sets any shake
const _shakeCamera = shakeCamera;
shakeCamera = function(magnitude, duration)
{
    if (screenShakeEnabled)
        _shakeCamera(magnitude, duration);
};

// ---------------------------------------------------------------------------------------
// DAMAGE NUMBERS - wrap the floating damage number popup (declared in appEffects.js)
const _spawnDamageNumber = spawnDamageNumber;
spawnDamageNumber = function(pos, amount)
{
    if (damageNumbersEnabled)
        _spawnDamageNumber(pos, amount);
};

// ---------------------------------------------------------------------------------------
// UNLOCKED WEAPONS - gate Weapon.switchWeapon() (declared in appObjects.js) by the
// persisted unlock list. All 4 base weapons ship unlocked by default (see appSave.js), so
// this changes nothing for existing gameplay; it only matters once something is
// deliberately left out of unlockedWeapons.
function isWeaponUnlocked(weaponType) { return gameSave.unlockedWeapons.includes(weaponType); }
function unlockWeapon(weaponType)
{
    if (isWeaponUnlocked(weaponType))
        return;
    gameSave.unlockedWeapons.push(weaponType);
    saveGame();
}
const _switchWeapon = Weapon.prototype.switchWeapon;
Weapon.prototype.switchWeapon = function(newType)
{
    if (isWeaponUnlocked(newType))
        _switchWeapon.call(this, newType);
};

// ---------------------------------------------------------------------------------------
// deferred: LOW GRAPHICS MODE + CAMERA EFFECTS need things declared in app.js, which loads
// after this file
onDeferredInit(function()
{
    // low graphics mode: `lowGraphicsSettings` exists in app.js as an auto-detected default
    // (only const->let was changed there so it can be overridden here). If the player has
    // never touched this setting, record the auto-detected value so the settings menu can
    // show an accurate initial state; otherwise apply their saved preference.
    if (gameSave.settings.lowGraphicsMode === null)
        gameSave.settings.lowGraphicsMode = lowGraphicsSettings;
    else
        lowGraphicsSettings = !!gameSave.settings.lowGraphicsMode;

    // CAMERA EFFECTS - wrap the screen-space damage flash / directional hit indicator
    // (declared in app.js). The death fade-to-black always still plays (it's important
    // game feedback, not just juice).
    const _drawDamageFeedback = drawDamageFeedback;
    drawDamageFeedback = function(player)
    {
        if (cameraEffectsEnabled || (player && player.isDeathFlash))
            _drawDamageFeedback(player);
    };
});

// ---------------------------------------------------------------------------------------
// MOUSE SENSITIVITY - reserved hook: today this scales the debug camera-zoom mouse wheel
// speed (applied once per actual wheel event, not per simulation tick, so it can never
// compound during catch-up frames), and is ready to drive any future mouse-based
// aiming/camera control at the same setting. onwheel is only defined when debug is on
// (declared in engineInput.js, already loaded).
if (typeof onwheel == 'function')
{
    const _onwheel = onwheel;
    onwheel = function(e) { _onwheel(e); mouseWheel *= mouseSensitivity; };
}

// ---------------------------------------------------------------------------------------
// wrap engineInit() so: (1) every queued onDeferredInit() hook runs exactly once, right
// before the game's own appInit(), and (2) a small extra step runs every fixed update tick,
// alongside the game's own appUpdate(). This has to happen before app.js runs (app.js calls
// engineInit(...) immediately), so appSettings.js must be loaded before app.js in index.html.
const _engineInit = engineInit;
engineInit = function(appInit, appUpdate, appUpdatePost, appRender, appRenderPost)
{
    const wrappedInit = function()
    {
        for (const hook of _deferredInitHooks)
            hook();
        _deferredInitHooks = [];
        appInit();
    };
    const wrappedUpdate = function()
    {
        appUpdate();

        // defined in appAchievements.js - keeps highScore/highestLevel/bestTime and
        // achievement progress up to date every tick
        typeof pollProgressionStats == 'function' && pollProgressionStats();

        // defined in appMobileControls.js - drives the hold-to-zoom-out map view button
        typeof pollMobileControls == 'function' && pollMobileControls();
    };
    _engineInit(wrappedInit, wrappedUpdate, appUpdatePost, appRender, appRenderPost);
};

// ---------------------------------------------------------------------------------------
// single entry point for the settings UI: updates the live value, applies any side effects,
// and persists to localStorage - always in that order, so a setting always "sticks" the
// instant it's changed
function applySetting(key, value)
{
    if (!(key in gameSave.settings))
        return; // unknown setting key - ignore rather than corrupt the save shape

    gameSave.settings[key] = value;

    switch (key)
    {
        case 'masterVolume':     audioVolume = value; break;
        case 'sfxVolume':        sfxVolume = value; break;
        case 'musicVolume':      musicVolume = value; break;
        case 'screenShake':      screenShakeEnabled = !!value; break;
        case 'particleQuality':  particleQualityMode = value; break;
        case 'lowGraphicsMode':  lowGraphicsSettings = !!value; break;
        case 'damageNumbers':    damageNumbersEnabled = !!value; break;
        case 'cameraEffects':    cameraEffectsEnabled = !!value; break;
        case 'mouseSensitivity': mouseSensitivity = value; break;
    }

    saveGame();
}

function getSetting(key) { return gameSave.settings[key]; }
