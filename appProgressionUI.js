/*
    Battlefield - Persistence/Settings/Achievements UI wiring
    - Loaded after appUI.js (same reason appUI.js loads at the end of <body>: the overlay
      markup in index.html must already exist in the DOM).
    - Never modifies appUI.js. Existing controls (master volume slider, mute toggle) keep
      their original onclick/oninput handlers exactly as-is; this file only *adds* extra
      listeners alongside them (via addEventListener) to also persist those values, and
      wires up the brand new controls added to index.html.
*/

'use strict';

///////////////////////////////////////////////////////////////////////////////
// settings panel: sync controls to saved values, wire changes to applySetting()

// keeps the --fill CSS variable in sync with a range input's current value/min/max, which
// the new custom slider track design (index.html) uses to draw its orange "filled" portion
function updateSliderFill(slider)
{
    const min = +slider.min || 0, max = +slider.max || 100;
    const pct = max > min ? (slider.value - min) / (max - min) * 100 : 0;
    slider.style.setProperty('--fill', pct + '%');
}
function wireSlider(slider, onInput)
{
    updateSliderFill(slider);
    slider.addEventListener('input', ()=> updateSliderFill(slider));
    onInput && slider.addEventListener('input', onInput);
}

function initSettingsUI()
{
    const s = gameSave.settings;

    // existing controls (owned by appUI.js) - just sync their displayed value and persist
    // changes alongside the game's own handling of them
    volumeSlider.value = Math.round(s.masterVolume * 100);
    muteToggle.checked = s.masterVolume <= 0;
    wireSlider(volumeSlider, ()=>
        !muteToggle.checked && applySetting('masterVolume', volumeSlider.value / 100));
    muteToggle.addEventListener('change', ()=>
        applySetting('masterVolume', muteToggle.checked ? 0 : volumeSlider.value / 100));

    // new controls
    const sfxSlider = document.getElementById('sfxVolumeSlider');
    sfxSlider.value = Math.round(s.sfxVolume * 100);
    wireSlider(sfxSlider, ()=> applySetting('sfxVolume', sfxSlider.value / 100));

    const musicSlider = document.getElementById('musicVolumeSlider');
    musicSlider.value = Math.round(s.musicVolume * 100);
    wireSlider(musicSlider, ()=> applySetting('musicVolume', musicSlider.value / 100));

    const screenShakeToggle = document.getElementById('screenShakeToggle');
    screenShakeToggle.checked = !!s.screenShake;
    screenShakeToggle.onchange = ()=> applySetting('screenShake', screenShakeToggle.checked ? 1 : 0);

    const particleQualitySelect = document.getElementById('particleQualitySelect');
    particleQualitySelect.value = s.particleQuality;
    particleQualitySelect.onchange = ()=> applySetting('particleQuality', particleQualitySelect.value);

    const lowGraphicsToggle = document.getElementById('lowGraphicsToggle');
    lowGraphicsToggle.checked = !!s.lowGraphicsMode;
    lowGraphicsToggle.onchange = ()=> applySetting('lowGraphicsMode', lowGraphicsToggle.checked ? 1 : 0);

    const damageNumbersToggle = document.getElementById('damageNumbersToggle');
    damageNumbersToggle.checked = !!s.damageNumbers;
    damageNumbersToggle.onchange = ()=> applySetting('damageNumbers', damageNumbersToggle.checked ? 1 : 0);

    const cameraEffectsToggle = document.getElementById('cameraEffectsToggle');
    cameraEffectsToggle.checked = !!s.cameraEffects;
    cameraEffectsToggle.onchange = ()=> applySetting('cameraEffects', cameraEffectsToggle.checked ? 1 : 0);

    const mouseSensitivitySlider = document.getElementById('mouseSensitivitySlider');
    mouseSensitivitySlider.value = Math.round(s.mouseSensitivity * 100);
    wireSlider(mouseSensitivitySlider, ()=> applySetting('mouseSensitivity', mouseSensitivitySlider.value / 100));
}

///////////////////////////////////////////////////////////////////////////////
// achievements panel: build the list once (locked entries show as silhouettes), then just
// refresh unlocked/locked state each time the panel is opened

function buildAchievementsList()
{
    const list = document.getElementById('achievementsList');
    list.innerHTML = '';
    for (const key in ACHIEVEMENTS)
    {
        const def = ACHIEVEMENTS[key];
        const row = document.createElement('div');
        row.className = 'achievement-row';
        row.id = 'achievementRow_' + key;
        row.innerHTML =
            '<div class="achievement-row-icon">\u2605</div>' +
            '<div class="achievement-row-text">' +
                '<div class="achievement-row-name">' + def.name + '</div>' +
                '<div class="achievement-row-desc">' + def.description + '</div>' +
            '</div>';
        list.appendChild(row);
    }
}

function refreshAchievementsList()
{
    const unlocked = gameSave.achievements.unlocked;
    for (const key in ACHIEVEMENTS)
    {
        const row = document.getElementById('achievementRow_' + key);
        if (row)
            row.classList.toggle('achievement-row-unlocked', !!unlocked[key]);
    }
}

function openAchievements(returnTo)
{
    ui.settingsReturnTo = returnTo;
    refreshAchievementsList();
    uiShow('achievementsPanel');
}

function closeAchievements()
{
    uiHide('achievementsPanel');
    if (ui.settingsReturnTo)
        uiShow(ui.settingsReturnTo);
}

///////////////////////////////////////////////////////////////////////////////
// main menu best-stats readout (highest level / high score / best time)

function refreshMainMenuStats()
{
    const el = document.getElementById('mainMenuStats');
    const s = gameSave.stats;
    if (s.highScore)
    {
        el.textContent = 'Best: Level ' + s.highestLevel + '  ·  Score ' + s.highScore +
            (s.bestTime ? '  ·  Time ' + formatTime(s.bestTime | 0) : '');
        el.style.display = '';
    }
    else
    {
        el.textContent = '';
        el.style.display = 'none';
    }
}

const _openMainMenu = openMainMenu;
openMainMenu = function()
{
    _openMainMenu();
    refreshMainMenuStats();
};

///////////////////////////////////////////////////////////////////////////////
// persisted "has played before" -> CONTINUE button available immediately after a refresh

const _startNewGame = startNewGame;
startNewGame = function()
{
    _startNewGame();
    gameSave.preferences.hasPlayedBefore = 1;
    saveGame();
};

///////////////////////////////////////////////////////////////////////////////
// wire up the new buttons (existing ones stay exactly as appUI.js left them)

document.getElementById('btnAchievementsFromMain').onclick = ()=> openAchievements('mainMenu');
document.getElementById('btnAchievementsFromPause').onclick = ()=> openAchievements('pauseMenu');
document.getElementById('btnAchievementsBack').onclick = closeAchievements;

buildAchievementsList();
initSettingsUI();
refreshMainMenuStats();

// if the player has beaten a level before (from a previous session), CONTINUE should be
// available right away instead of waiting for hasPlayedBefore to be set again this session
if (gameSave.preferences.hasPlayedBefore)
{
    ui.hasPlayedBefore = 1;
    document.getElementById('btnContinue').disabled = false;
}
