/*
    Battlefield - Achievement System
    - ACHIEVEMENTS is the single modular table: adding a new achievement later means adding
      one entry here plus (if it needs a brand new stat) one counter in appSave.js's
      achievements.stats and one place that increments it. Nothing else needs to change -
      checkAchievements() re-evaluates every locked achievement's check() automatically.
    - All progress hooks are done by wrapping existing functions/class methods (see below),
      so nothing in appLevel.js/appCharacters.js/appUI.js needs to be touched.
    - Unlocking shows a popup notification with a slide-in/out animation and a sound.
*/

'use strict';

const ACHIEVEMENTS =
{
    FIRST_BLOOD:
    {
        name: 'FIRST BLOOD',
        description: 'Get your first enemy kill.',
        check: stats => stats.totalKills >= 1,
    },
    KILLER:
    {
        name: 'KILLER',
        description: 'Eliminate 25 enemies.',
        check: stats => stats.totalKills >= 25,
    },
    DEMOLITION_EXPERT:
    {
        name: 'DEMOLITION EXPERT',
        description: 'Kill 10 enemies with explosions or environmental damage.',
        check: stats => stats.demolitionKills >= 10,
    },
    SURVIVOR:
    {
        name: 'SURVIVOR',
        description: 'Complete a Survive objective.',
        check: stats => stats.surviveObjectivesCompleted >= 1,
    },
    UNTOUCHABLE:
    {
        name: 'UNTOUCHABLE',
        description: 'Complete an objective without taking damage.',
        check: stats => stats.untouchableObjectivesCompleted >= 1,
    },
    BOSS_SLAYER:
    {
        name: 'BOSS SLAYER',
        description: 'Defeat a boss.',
        check: stats => stats.bossesKilled >= 1,
    },
};

// re-evaluates every not-yet-unlocked achievement against current stats, unlocking (and
// queueing a toast for) any whose condition now passes
function checkAchievements()
{
    const stats = gameSave.achievements.stats;
    const unlocked = gameSave.achievements.unlocked;
    for (const key in ACHIEVEMENTS)
    {
        if (unlocked[key])
            continue;
        if (ACHIEVEMENTS[key].check(stats))
        {
            unlocked[key] = Date.now();
            queueAchievementToast(key);
        }
    }
}

///////////////////////////////////////////////////////////////////////////////
// progress tracking hooks - each wraps one existing function/method so achievement and
// long-term stat tracking sits entirely on top of the existing game code

let tookDamageThisLevel = 0;   // reset each level, drives the UNTOUCHABLE achievement
let lastCheckedObjective = null;

// enemy kills: total kill count + demolition (explosive/environmental) kill count
const _addKillScore = addKillScore;
addKillScore = function(enemy, damagingObject)
{
    _addKillScore(enemy, damagingObject);

    const stats = gameSave.achievements.stats;
    ++stats.totalKills;

    const isExplosiveKill = !!(damagingObject && damagingObject.isExplosive);
    const isEnvironmentalKill = !damagingObject && enemy.burnTimer && enemy.burnTimer.isSet();
    if (isExplosiveKill || isEnvironmentalKill)
        ++stats.demolitionKills;

    checkAchievements();
    saveGame();
};

// boss kills
const _bossKill = Boss.prototype.kill;
Boss.prototype.kill = function(damagingObject)
{
    const wasAlive = !this.isDead();
    _bossKill.call(this, damagingObject);
    if (wasAlive && this.isDead())
    {
        ++gameSave.achievements.stats.bossesKilled;
        checkAchievements();
        saveGame();
    }
};

// player damage taken this level (for UNTOUCHABLE)
const _playerDamage = Player.prototype.damage;
Player.prototype.damage = function(damage, damagingObject)
{
    const healthBefore = this.health;
    _playerDamage.call(this, damage, damagingObject);
    if (this.health < healthBefore)
        tookDamageThisLevel = 1;
};

// reset the per-level UNTOUCHABLE tracking and the objective-completion guard whenever a
// new level starts
const _nextLevel = nextLevel;
nextLevel = function()
{
    _nextLevel();
    tookDamageThisLevel = 0;
    lastCheckedObjective = null;
};

// best-time stat: fastest level clear, captured the moment the victory screen is shown.
// showVictoryScreen() is declared in appUI.js, which loads much later in the page (right
// before it, near the bottom of <body>), so this wrap is deferred until just before the
// game actually starts (see onDeferredInit() in appSettings.js) instead of running here at
// this file's own load time.
onDeferredInit(function()
{
    const _showVictoryScreen = showVictoryScreen;
    showVictoryScreen = function()
    {
        const clearTime = levelTimer.get();
        if (!gameSave.stats.bestTime || clearTime < gameSave.stats.bestTime)
            gameSave.stats.bestTime = clearTime;
        saveGame();
        _showVictoryScreen();
    };
});

function onObjectiveComplete(objective)
{
    const stats = gameSave.achievements.stats;
    if (objective.type == 'survive')
        ++stats.surviveObjectivesCompleted;
    if (!tookDamageThisLevel)
        ++stats.untouchableObjectivesCompleted;
    checkAchievements();
}

// called every fixed update tick (hooked into engineInit in appSettings.js) - keeps
// highScore/highestLevel current and watches for objective completion
function pollProgressionStats()
{
    let changed = 0;

    if (typeof level == 'number' && level > gameSave.stats.highestLevel)
        gameSave.stats.highestLevel = level, changed = 1;
    if (typeof score == 'number' && score > gameSave.stats.highScore)
        gameSave.stats.highScore = score, changed = 1;

    if (typeof currentObjective != 'undefined' && currentObjective &&
        currentObjective.state == objectiveState_complete && currentObjective !== lastCheckedObjective)
    {
        lastCheckedObjective = currentObjective;
        onObjectiveComplete(currentObjective);
        changed = 1;
    }

    updateAchievementToasts();

    changed && saveGame();
}

///////////////////////////////////////////////////////////////////////////////
// achievement popup notification - queued so unlocking several achievements at once still
// shows them one at a time instead of overlapping

const sound_achievement = [1.2,.1,523.25,.02,.08,.25,,1.8,,,400,.1,,,,,,.6,.04];

let achievementToastQueue = [];
let achievementToastTimer = new Timer;
const achievementToastDuration = 3.5;

function queueAchievementToast(key)
{
    achievementToastQueue.push(key);
}

// plays a UI sound respecting the sfx/master volume settings, independent of world position
function playUISound(zzfxSound)
{
    if (!soundEnable || !hadInput)
        return;
    const copy = [...zzfxSound];
    copy[0] = (copy[0] || 1) * sfxVolume;
    zzfx(...copy);
}

function updateAchievementToasts()
{
    if (achievementToastTimer.isSet())
    {
        if (achievementToastTimer.elapsed())
        {
            achievementToastTimer.unset();
            hideAchievementToast();
        }
        return;
    }

    if (achievementToastQueue.length)
    {
        const key = achievementToastQueue.shift();
        showAchievementToast(key);
        achievementToastTimer.set(achievementToastDuration);
        playUISound(sound_achievement);
    }
}

// DOM rendering for the toast - looked up lazily (not at script load time) since this file
// loads in <head>, before the toast container markup in the body exists yet. By the time
// this ever actually runs (during gameplay) the whole document is long since parsed.
function showAchievementToast(key)
{
    const def = ACHIEVEMENTS[key];
    const container = document.getElementById('achievementToastContainer');
    if (!def || !container)
        return;

    container.innerHTML =
        '<div class="achievement-toast-icon">\u2605</div>' +
        '<div class="achievement-toast-text">' +
            '<div class="achievement-toast-label">ACHIEVEMENT UNLOCKED</div>' +
            '<div class="achievement-toast-name">' + def.name + '</div>' +
            '<div class="achievement-toast-desc">' + def.description + '</div>' +
        '</div>';
    container.classList.remove('achievement-toast-hide');
    container.classList.add('achievement-toast-show');
}

function hideAchievementToast()
{
    const container = document.getElementById('achievementToastContainer');
    if (!container)
        return;
    container.classList.remove('achievement-toast-show');
    container.classList.add('achievement-toast-hide');
}
