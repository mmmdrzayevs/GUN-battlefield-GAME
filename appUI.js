/*
    Battlefield - UI/Menu controller
    - Pure DOM overlay layer on top of the existing canvas game; never touches game rendering
    - Pause is implemented by toggling the engine's own existing `paused` variable, which
      already stops the fixed-timestep update loop (physics/enemy AI/timers all freeze
      automatically since they only ever advance inside that loop), while rendering keeps
      running every frame regardless - so the frozen game stays visible behind the menu
    - Everything here talks to the game only through the same globals/functions the rest of
      the app already exposes (resetGame, nextLevel, paused, players, score, totalKills, etc)
*/

'use strict';

// the game starts paused, sitting frozen behind the main menu (still fully generated via the
// existing appInit()->resetGame() flow) the instant PLAY/CONTINUE is pressed. This line runs
// synchronously while the page's scripts are loading, well before the async tileImage.onload
// in engine.js would otherwise start the frame loop, so gameplay never has a chance to run
// before the menu is deliberately dismissed.
paused = 1;

const ui =
{
    hasPlayedBefore: 0,
    screen: null, // currently active overlay element, or null
    settingsReturnTo: null,
    bestScore: 0,
};

function uiShow(id)
{
    if (ui.screen)
        ui.screen.classList.remove('active');
    ui.screen = document.getElementById(id);
    ui.screen && ui.screen.classList.add('active');
}

function uiHide(id)
{
    const el = document.getElementById(id);
    el && el.classList.remove('active');
    if (ui.screen === el)
        ui.screen = null;
}

function pauseGame()  { paused = 1; }
function resumeGame() { paused = 0; }

///////////////////////////////////////////////////////////////////////////////
// screen transitions

function openMainMenu()
{
    pauseGame();
    uiShow('mainMenu');
    document.getElementById('btnContinue').disabled = !ui.hasPlayedBefore;
}

function startNewGame()
{
    ui.hasPlayedBefore = 1;
    resetGame();
    uiHide('mainMenu');
    uiHide('pauseMenu');
    resumeGame();
}

function continueGame()
{
    uiHide('mainMenu');
    resumeGame();
}

function openPauseMenu()
{
    pauseGame();
    uiShow('pauseMenu');
}

function closePauseMenu()
{
    uiHide('pauseMenu');
    resumeGame();
}

function openSettings(returnTo)
{
    ui.settingsReturnTo = returnTo;
    uiShow('settingsPanel');
}

function closeSettings()
{
    uiHide('settingsPanel');
    if (ui.settingsReturnTo)
        uiShow(ui.settingsReturnTo);
}

function openControls(returnTo)
{
    ui.settingsReturnTo = returnTo;
    uiShow('controlsPanel');
}

function closeControls()
{
    uiHide('controlsPanel');
    if (ui.settingsReturnTo)
        uiShow(ui.settingsReturnTo);
}

// called from app.js when the player runs out of lives
function showGameOverScreen()
{
    pauseGame();
    document.getElementById('gameOverStats').innerHTML =
        '<div><span>Score</span><span>' + score + '</span></div>' +
        '<div><span>Kills</span><span>' + totalKills + '</span></div>' +
        '<div><span>Level</span><span>' + level + '</span></div>' +
        '<div><span>Time</span><span>' + formatTime(gameTimer.get()|0) + '</span></div>';
    uiShow('gameOverScreen');
}

// called from app.js when a level's win condition (objective or all-enemies) is met
function showVictoryScreen()
{
    pauseGame();
    ui.bestScore = Math.max(ui.bestScore, score);
    document.getElementById('victoryStats').innerHTML =
        '<div><span>Score</span><span>' + score + '  (+' + (score-levelStartScore) + ')</span></div>' +
        '<div><span>Kills</span><span>' + (totalKills-levelStartKills) + '</span></div>' +
        '<div><span>Time</span><span>' + formatTime(levelTimer.get()|0) + '</span></div>' +
        '<div><span>Best Score</span><span>' + ui.bestScore + '</span></div>';
    uiShow('victoryScreen');
}

///////////////////////////////////////////////////////////////////////////////
// button wiring

document.getElementById('btnPlay').onclick = startNewGame;
document.getElementById('btnContinue').onclick = ()=> ui.hasPlayedBefore && continueGame();
document.getElementById('btnSettingsFromMain').onclick = ()=> openSettings('mainMenu');
document.getElementById('btnControlsFromMain').onclick = ()=> openControls('mainMenu');

document.getElementById('btnResume').onclick = closePauseMenu;
document.getElementById('btnRestart').onclick = startNewGame;
document.getElementById('btnSettingsFromPause').onclick = ()=> openSettings('pauseMenu');
document.getElementById('btnControlsFromPause').onclick = ()=> openControls('pauseMenu');
document.getElementById('btnMainMenuFromPause').onclick = ()=> { uiHide('pauseMenu'); openMainMenu(); };

document.getElementById('btnSettingsBack').onclick = closeSettings;
document.getElementById('btnControlsBack').onclick = closeControls;

document.getElementById('btnGameOverRestart').onclick = ()=> { uiHide('gameOverScreen'); startNewGame(); };
document.getElementById('btnGameOverMainMenu').onclick = ()=> { uiHide('gameOverScreen'); openMainMenu(); };

document.getElementById('btnNextLevel').onclick = ()=>
{
    uiHide('victoryScreen');
    nextLevel();
    resumeGame();
};
document.getElementById('btnReplay').onclick = ()=> { uiHide('victoryScreen'); startNewGame(); };

// settings: master volume + mute, wired directly to the existing audioVolume tunable
const volumeSlider = document.getElementById('volumeSlider');
const muteToggle = document.getElementById('muteToggle');
volumeSlider.oninput = ()=>
{
    if (!muteToggle.checked)
        audioVolume = volumeSlider.value / 100;
};
muteToggle.onchange = ()=> { audioVolume = muteToggle.checked ? 0 : volumeSlider.value / 100; };

///////////////////////////////////////////////////////////////////////////////
// Esc toggles pause - a plain DOM listener, independent of the engine's own (paused-gated)
// input/update loop, so it keeps working no matter what state the game is in
document.addEventListener('keydown', (e)=>
{
    if (e.keyCode != 27)
        return;

    if (ui.screen === document.getElementById('settingsPanel'))
        closeSettings();
    else if (ui.screen === document.getElementById('controlsPanel'))
        closeControls();
    else if (ui.screen === document.getElementById('pauseMenu'))
        closePauseMenu();
    else if (!ui.screen || ui.screen === document.getElementById('mainMenu'))
        return; // no pause toggle from the main menu itself
    else
        openPauseMenu();
});

// the game starts paused, sitting frozen behind the main menu, fully initialized and ready
// to go the instant PLAY is pressed - see the small appInit() hook in app.js
