/*
    Battlefield - Save / Persistence System
    - Versioned localStorage save (safe to extend later: bump SAVE_VERSION and add a
      migration step in migrateSaveData() if a future change needs to transform old data)
    - Never throws and never blocks gameplay: any corrupt/missing/invalid localStorage
      data silently falls back to defaultSaveData() instead of crashing the game
    - Pure persistence layer - knows nothing about game rules. appSettings.js and
      appAchievements.js read/write into the `gameSave` object this file exposes.
*/

'use strict';

const SAVE_KEY = 'battlefield_save';
const SAVE_VERSION = 1;

// the full shape of a save file - every field the game persists lives here so there is a
// single source of truth for "what does a save look like" and so a corrupted/partial file
// can always be safely repaired by merging onto this
function defaultSaveData()
{
    return {
        version: SAVE_VERSION,

        // long term progression stats
        stats:
        {
            highestLevel: 0,
            highScore: 0,
            bestTime: 0, // seconds to clear a level, 0 = not set yet; lower is better
        },

        // player-adjustable settings (see appSettings.js for how these are applied)
        settings:
        {
            masterVolume: .5,
            sfxVolume: 1,
            musicVolume: 1,
            screenShake: 1,
            particleQuality: 'high', // 'low' | 'medium' | 'high'
            lowGraphicsMode: null,   // null = auto-detect (engine default), true/false = explicit user choice
            damageNumbers: 1,
            cameraEffects: 1,
            mouseSensitivity: 1,     // 0.5 - 2.0
        },

        // weapon types unlocked so far (indices into WEAPON_TYPES) - all 4 base weapons start
        // unlocked so existing gameplay is unchanged; this exists so future weapons can ship
        // locked-by-default and be unlocked through achievements/progression without any
        // further changes to the save format
        unlockedWeapons: [0, 1, 2, 3],

        // achievement system state (see appAchievements.js for definitions)
        achievements:
        {
            unlocked: {},  // { ACHIEVEMENT_KEY: unixTimestamp }
            stats:
            {
                totalKills: 0,
                demolitionKills: 0,
                bossesKilled: 0,
                surviveObjectivesCompleted: 0,
                untouchableObjectivesCompleted: 0,
            },
        },

        preferences:
        {
            hasPlayedBefore: 0,
            seenLandscapeHint: 0,
        },
    };
}

// deep-merges saved data onto a set of safe defaults, field by field, so that any field
// that's missing, the wrong type, or otherwise corrupted just falls back to its default
// instead of taking down the whole save (or the game)
function mergeSaveData(defaults, loaded)
{
    if (loaded == null || typeof loaded != 'object' || Array.isArray(loaded))
        return defaults;

    // open-ended dictionary fields (currently just achievements.unlocked) start out as an
    // empty {} in defaults, so there are no fixed keys to walk below - copy the loaded
    // object wholesale instead (still validated: must actually be a plain object, and every
    // value must be the expected type so a corrupted entry can't smuggle in bad data)
    if (Object.keys(defaults).length == 0)
        return isPlainObject(loaded) ? sanitizeDictionary(loaded) : defaults;

    const out = {};
    for (const key in defaults)
    {
        const defaultValue = defaults[key];
        const loadedValue = loaded[key];

        if (Array.isArray(defaultValue))
            out[key] = Array.isArray(loadedValue) ? loadedValue.slice() : defaultValue;
        else if (defaultValue != null && typeof defaultValue == 'object')
            out[key] = mergeSaveData(defaultValue, loadedValue);
        else if (loadedValue != null && typeof loadedValue == typeof defaultValue)
            out[key] = loadedValue;
        else
            out[key] = defaultValue;
    }
    return out;
}

function isPlainObject(v) { return v != null && typeof v == 'object' && !Array.isArray(v); }

// for a dictionary-shaped field (unknown key set), only keep entries whose value is a
// number - which is all achievements.unlocked (timestamps) will ever need to hold
function sanitizeDictionary(obj)
{
    const out = {};
    for (const key in obj)
        if (typeof obj[key] == 'number')
            out[key] = obj[key];
    return out;
}

// place for future save-format migrations: called once right after a save is loaded, before
// merging onto defaults. Since defaultSaveData() + mergeSaveData() already repair missing
// fields safely, this is only needed if a future version needs to actively transform old
// data (e.g. renaming a field, converting units) rather than just filling in a new default.
function migrateSaveData(data)
{
    // no migrations yet - SAVE_VERSION starts at 1
    return data;
}

const SaveManager =
{
    load()
    {
        try
        {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw)
                return defaultSaveData();

            let parsed = JSON.parse(raw);
            parsed = migrateSaveData(parsed);
            const merged = mergeSaveData(defaultSaveData(), parsed);
            merged.version = SAVE_VERSION;
            return merged;
        }
        catch (e)
        {
            // corrupted JSON, localStorage disabled (private browsing), or anything else -
            // never let a bad save file crash the game, just start fresh
            console.warn('Battlefield: save data could not be read, starting fresh.', e);
            return defaultSaveData();
        }
    },

    write(data)
    {
        if (this.disabled)
            return false; // already confirmed broken this session - don't keep retrying

        try
        {
            localStorage.setItem(SAVE_KEY, JSON.stringify(data));
            return true;
        }
        catch (e)
        {
            // e.g. quota exceeded or localStorage blocked entirely (some mobile browsers'
            // privacy modes do this) - stop attempting further writes for the rest of this
            // session instead of repeatedly failing (and logging) on every single save call,
            // which could otherwise add up to real, noticeable stutter during heavy combat
            // (a save is triggered on every kill)
            console.warn('Battlefield: could not write save data, disabling further saves this session.', e);
            this.disabled = true;
            return false;
        }
    },
};

// the live, in-memory save state - everything else in the game reads/writes this object
// directly, then calls saveGame() to persist it
let gameSave = SaveManager.load();

let _saveDebounceHandle = null;
function saveGame()
{
    if (SaveManager.disabled)
        return;
    // debounce so rapid-fire stat updates (e.g. several kills in one frame) don't hit
    // localStorage more than necessary
    clearTimeout(_saveDebounceHandle);
    _saveDebounceHandle = setTimeout(saveGameNow, 250);
}
function saveGameNow()
{
    if (SaveManager.disabled)
        return;
    clearTimeout(_saveDebounceHandle);
    SaveManager.write(gameSave);
}

// make sure anything still pending gets flushed if the tab is closed/refreshed
addEventListener('beforeunload', saveGameNow);
addEventListener('visibilitychange', ()=> document.visibilityState == 'hidden' && saveGameNow());
