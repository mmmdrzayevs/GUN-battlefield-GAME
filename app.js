/*
    Javascript Space Game
    By aashuu  

*/

'use strict';

const clampCamera = !debug;
let lowGraphicsSettings = glOverlay = !window['chrome']; // only chromium uses high settings (mutable: the settings system can override this auto-detected default with the player's saved preference)
const startCameraScale = 4*16;
const defaultCameraScale = 4*16;
const maxPlayers = 4;

const team_none = 0;
const team_player = 1;
const team_enemy = 2;

let updateWindowSize, renderWindowSize, gameplayWindowSize;
let gameOverShown = 0, victoryShown = 0; // one-shot guards for the DOM Game Over / Victory screens
let lastDrawnCombo = 0, comboPopTimer = new Timer; // drives the combo-increase pop animation

///////////////////////////////////////////////////////////////////////////////
// HUD: stamina / dash cooldown / animated health bar + damage & death screen feedback

function drawPlayerHUD(player, index)
{
    if (!player)
        return;

    const barWidth = 150, barHeight = 14, gap = 4;
    // on touch devices, shift right to clear the left joystick (bottom-left corner);
    // desktop keeps the original tight corner margin exactly as before
    const margin = isTouchDevice ? 150 : 10;
    const x = margin + index * (barWidth + 20);
    const yHealth  = mainCanvas.height - 90;
    const yStamina = mainCanvas.height - 90 + (barHeight+gap);
    const yDash    = mainCanvas.height - 90 + (barHeight+gap)*2;
    const yWeapon  = mainCanvas.height - 90 + (barHeight+gap)*3;

    // animated health bar (eases towards the player's actual health each frame)
    player.displayHealth += (player.health - player.displayHealth) * .15;
    const healthPercent = player.healthMax ? clamp(player.displayHealth / player.healthMax) : 0;
    mainContext.fillStyle = 'rgba(0,0,0,.6)';
    mainContext.fillRect(x, yHealth, barWidth, barHeight);
    mainContext.fillStyle = healthPercent > .3 ? '#2ecc40' : '#ff4136';
    mainContext.fillRect(x+2, yHealth+2, (barWidth-4)*healthPercent, barHeight-4);

    // stamina bar (used up by sprinting)
    const staminaPercent = clamp(player.stamina / staminaMax);
    mainContext.fillStyle = 'rgba(0,0,0,.6)';
    mainContext.fillRect(x, yStamina, barWidth, barHeight);
    mainContext.fillStyle = player.sprinting ? '#ffdc00' : '#7fdbff';
    mainContext.fillRect(x+2, yStamina+2, (barWidth-4)*staminaPercent, barHeight-4);

    // dash cooldown bar (fills up as the dash recharges, lights up cyan when ready)
    const dashPercent = player.dodgeRechargeTimer.active() ? player.dodgeRechargeTimer.getPercent() : 1;
    mainContext.fillStyle = 'rgba(0,0,0,.6)';
    mainContext.fillRect(x, yDash, barWidth, barHeight);
    mainContext.fillStyle = dashPercent >= 1 ? '#39cccc' : '#666';
    mainContext.fillRect(x+2, yDash+2, (barWidth-4)*dashPercent, barHeight-4);

    // active weapon: name, magazine/reserve ammo, reload progress
    const weapon = player.weapon;
    if (weapon)
    {
        const def = weapon.weaponDef, ammo = weapon.ammo;
        const reloading = ammo.reloadTimer.active();

        mainContext.fillStyle = 'rgba(0,0,0,.6)';
        mainContext.fillRect(x, yWeapon, barWidth, barHeight);

        if (reloading)
        {
            // reload progress fill
            mainContext.fillStyle = '#f0a020';
            mainContext.fillRect(x+2, yWeapon+2, (barWidth-4)*ammo.reloadTimer.getPercent(), barHeight-4);
        }
        else
        {
            // ammo fill (empty magazine flashes red)
            const magazinePercent = def.magazineSize ? clamp(ammo.magazineAmmo / def.magazineSize) : 0;
            mainContext.fillStyle = ammo.magazineAmmo ? def.color.rgba() :
                (Math.sin(time*20) > 0 ? '#ff4136' : '#600');
            mainContext.fillRect(x+2, yWeapon+2, (barWidth-4)*magazinePercent, barHeight-4);
        }

        // ammo-change pop animation: briefly enlarges/brightens the label when the magazine
        // count changes (fires on every shot and on reload completing)
        if (player.lastDrawnAmmo === undefined)
            player.lastDrawnAmmo = ammo.magazineAmmo;
        if (player.lastDrawnAmmo !== ammo.magazineAmmo)
        {
            player.ammoPopTimer = player.ammoPopTimer || new Timer;
            player.ammoPopTimer.set(.2);
            player.lastDrawnAmmo = ammo.magazineAmmo;
        }
        const ammoPop = player.ammoPopTimer && player.ammoPopTimer.active() ?
            1 + .3*(1-player.ammoPopTimer.getPercent()) : 1;

        const savedAlign = mainContext.textAlign, savedFont = mainContext.font, savedBaseline = mainContext.textBaseline;
        const label = (reloading ? def.name + ' - reloading...' : def.name + '  ' + ammo.magazineAmmo + '/' + ammo.reserveAmmo)
            + '   Grenades: ' + player.grenadeCount;
        mainContext.save();
        mainContext.translate(x+4, yWeapon+barHeight/2+1);
        mainContext.scale(ammoPop, ammoPop);
        mainContext.textAlign = 'left';
        mainContext.textBaseline = 'middle';
        mainContext.font = '11px arial';
        mainContext.fillStyle = ammoPop > 1.05 ? '#ffe066' : '#fff';
        mainContext.fillText(label, 0, 0);
        mainContext.restore();
        mainContext.textAlign = savedAlign;
        mainContext.font = savedFont;
        mainContext.textBaseline = savedBaseline;
    }

    // active power-ups: one small square per active timed buff, filling down as it counts
    // down, labeled with an initial letter (A=Armor, D=Damage, S=Speed, R=Rapid Fire) so
    // Armor specifically is always clearly identifiable as its own HUD element, plus a
    // shield icon while there's still absorb health left in the buffer
    const yPowerUps = yWeapon + barHeight + gap*2;
    const boxSize = 16;
    let boxX = x;
    const powerUpLabels = { [powerUp_armor]:'A', [powerUp_damageBoost]:'D', [powerUp_speedBoost]:'S', [powerUp_rapidFire]:'R' };
    for (const type of POWERUP_TYPE_KEYS)
    {
        const def = POWERUP_TYPES[type];
        if (def.instant || !player.isPowerUpActive(type))
            continue;

        const remainingPercent = 1 - player.powerUpTimers[type].getPercent();
        mainContext.fillStyle = 'rgba(0,0,0,.6)';
        mainContext.fillRect(boxX, yPowerUps, boxSize, boxSize);
        mainContext.fillStyle = def.color.rgba();
        mainContext.fillRect(boxX+2, yPowerUps+2+(boxSize-4)*(1-remainingPercent),
            boxSize-4, (boxSize-4)*remainingPercent);

        const savedAlign2 = mainContext.textAlign;
        mainContext.textAlign = 'center';
        mainContext.font = 'bold 10px arial';
        mainContext.fillStyle = '#000';
        mainContext.fillText(powerUpLabels[type] || '?', boxX+boxSize/2, yPowerUps+boxSize+11);
        mainContext.textAlign = savedAlign2;

        boxX += boxSize + 4;
    }
    if (player.shieldHealth > 0)
    {
        mainContext.fillStyle = 'rgba(0,0,0,.6)';
        mainContext.fillRect(boxX, yPowerUps, boxSize, boxSize);
        mainContext.fillStyle = POWERUP_TYPES[powerUp_shield].color.rgba();
        const shieldPercent = clamp(player.shieldHealth / POWERUP_TYPES[powerUp_shield].shieldAmount);
        mainContext.fillRect(boxX+2, yPowerUps+2+(boxSize-4)*(1-shieldPercent), boxSize-4, (boxSize-4)*shieldPercent);

        const savedAlign3 = mainContext.textAlign;
        mainContext.textAlign = 'center';
        mainContext.font = 'bold 10px arial';
        mainContext.fillStyle = '#000';
        mainContext.fillText('SH', boxX+boxSize/2, yPowerUps+boxSize+11);
        mainContext.textAlign = savedAlign3;
    }
}

function drawDamageFeedback(player)
{
    if (!player || !player.hitFlashTimer.active())
        return;

    const p = 1 - player.hitFlashTimer.getPercent(); // starts at 1, fades to 0

    if (player.isDeathFlash)
    {
        // death: quick fade to black
        mainContext.fillStyle = `rgba(0,0,0,${.8*p})`;
        mainContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
        return;
    }

    // damage: red screen flash
    mainContext.fillStyle = `rgba(255,0,0,${.35*p})`;
    mainContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

    // directional indicator pointing towards where the damage came from
    if (player.lastDamageSourcePos)
    {
        const worldDelta = player.lastDamageSourcePos.subtract(player.pos);
        if (worldDelta.lengthSquared() > .04)
        {
            const screenPos = worldToScreen(player.pos);
            const dx = worldDelta.x, dy = -worldDelta.y; // canvas y is flipped vs world y
            const angle = Math.atan2(dy, dx);
            const radius = 90;

            mainContext.save();
            mainContext.translate(screenPos.x + Math.cos(angle)*radius, screenPos.y + Math.sin(angle)*radius);
            mainContext.rotate(angle);
            mainContext.fillStyle = `rgba(255,40,20,${.8*p})`;
            mainContext.beginPath();
            mainContext.moveTo(20,0);
            mainContext.lineTo(-10,-14);
            mainContext.lineTo(-10,14);
            mainContext.closePath();
            mainContext.fill();
            mainContext.restore();
        }
    }
}

function drawObjectivePanel()
{
    if (!currentObjective)
        return;

    const def = OBJECTIVE_TYPES[currentObjective.type];
    const x = mainCanvas.width - 16, y = 16;
    const savedAlign = mainContext.textAlign, savedBaseline = mainContext.textBaseline, savedFont = mainContext.font;
    mainContext.textAlign = 'right';
    mainContext.textBaseline = 'top';

    if (currentObjective.state == objectiveState_complete)
    {
        // brief pulsing "complete" banner in place of the normal objective text
        mainContext.font = 'bold 20px arial';
        mainContext.fillStyle = `rgba(80,255,120,${.6+.4*Math.sin(time*10)})`;
        mainContext.fillText('OBJECTIVE COMPLETE!', x, y);
    }
    else
    {
        mainContext.font = 'bold 13px arial';
        mainContext.fillStyle = '#fff';
        mainContext.fillText('OBJECTIVE', x, y);

        mainContext.font = '13px arial';
        mainContext.fillStyle = '#ffd700';
        mainContext.fillText(def.label, x, y+18);

        const progressText = def.progressText(currentObjective);
        if (progressText)
        {
            mainContext.font = '12px arial';
            mainContext.fillStyle = '#ccc';
            mainContext.fillText(progressText, x, y+36);
        }
    }

    mainContext.textAlign = savedAlign;
    mainContext.textBaseline = savedBaseline;
    mainContext.font = savedFont;
}

function drawLevelCompleteScreen()
{
    if (!levelEndTimer.isSet())
        return;

    // flush any gl-batched sprites queued so far (including the fade rect drawn just before
    // this is called) so this text reliably renders on top of the fade instead of risking
    // being dimmed by its later flush - same trick FloatingText uses in appEffects.js
    glEnable && glCopyToContext(mainContext);

    const p = clamp(levelEndTimer.get());
    const savedAlign = mainContext.textAlign;
    mainContext.textAlign = 'center';
    mainContext.globalAlpha = p;

    mainContext.font = 'bold .7in impact';
    mainContext.fillStyle = '#fff';
    mainContext.fillText('LEVEL COMPLETE', mainCanvas.width/2, mainCanvas.height/2-90);

    mainContext.font = '.3in arial';
    const lines =
    [
        'Score: ' + score + '  (+' + (score-levelStartScore) + ')',
        'Kills: ' + (totalKills-levelStartKills),
        'Time: ' + formatTime(levelTimer.get()|0),
        'Reward: +' + lastObjectiveReward,
        'Next Level: ' + (level+1),
    ];
    lines.forEach((line,i)=> mainContext.fillText(line, mainCanvas.width/2, mainCanvas.height/2 - 30 + i*30));

    mainContext.globalAlpha = 1;
    mainContext.textAlign = savedAlign;
}

function drawBossHealthBar()
{
    if (!currentBoss || currentBoss.isDead())
        return;

    const barWidth = 400, barHeight = 22;
    const x = (mainCanvas.width-barWidth)/2, y = 46;
    const healthPercent = clamp(currentBoss.health / currentBoss.healthMax);

    const savedAlign = mainContext.textAlign;
    mainContext.textAlign = 'center';

    // name/phase label
    mainContext.font = 'bold 16px arial';
    mainContext.fillStyle = '#fff';
    mainContext.fillText('BOSS' + (currentBoss.bossState == bossState_enraged ? '  -  ENRAGED' : ''),
        mainCanvas.width/2, y-8);

    // bar background + fill, colored by phase (purple -> orange -> red as it escalates)
    mainContext.fillStyle = 'rgba(0,0,0,.7)';
    mainContext.fillRect(x-2, y-2, barWidth+4, barHeight+4);
    mainContext.fillStyle = currentBoss.bossPhase==3 ? '#ff2222' : currentBoss.bossPhase==2 ? '#ff8800' : '#aa44ff';
    mainContext.fillRect(x, y, barWidth*healthPercent, barHeight);

    // brief white flash overlay right when it takes a hit, for extra readability on a bar
    // this prominent
    if (currentBoss.bossState == bossState_damage)
    {
        mainContext.fillStyle = `rgba(255,255,255,${.5*(1-currentBoss.stateTimer.getPercent())})`;
        mainContext.fillRect(x, y, barWidth*healthPercent, barHeight);
    }

    mainContext.textAlign = savedAlign;
}

function drawLevelEventNotification()
{
    if (!levelEventNotificationTimer.active())
        return;

    const p = 1 - levelEventNotificationTimer.getPercent(); // 1 at start, fades to 0
    const savedAlign = mainContext.textAlign;
    mainContext.textAlign = 'center';
    mainContext.font = 'bold .4in impact';
    mainContext.fillStyle = `rgba(255,140,20,${clamp(p*2)})`;
    mainContext.fillText(levelEventNotificationText.toUpperCase(), mainCanvas.width/2, 110);
    mainContext.textAlign = savedAlign;
}

engineInit(

///////////////////////////////////////////////////////////////////////////////
()=> // appInit 
{
    resetGame();
    cameraScale = startCameraScale;
},

///////////////////////////////////////////////////////////////////////////////
()=> // appUpdate
{
    updateObjective();
    updateLevelEvents();

    const cameraSize = vec2(mainCanvas.width, mainCanvas.height).scale(1/cameraScale);
    renderWindowSize = cameraSize.add(vec2(5));

    gameplayWindowSize = vec2(mainCanvas.width, mainCanvas.height).scale(1/defaultCameraScale);
    updateWindowSize = gameplayWindowSize.add(vec2(30));
    //debugRect(cameraPos, maxGameplayCameraSize);
    //debugRect(cameraPos, updateWindowSize);

    if (debug)
    {
        randSeeded(randSeeded(randSeeded(randSeed = Date.now()))); // set random seed for debug mode stuf
        if (keyWasPressed(81))
            new Enemy(mousePosWorld);

        if (keyWasPressed(84))
        {
            //for(let i=30;i--;)
                new Prop(mousePosWorld);
        }

        if (keyWasPressed(69))
            explosion(mousePosWorld);

        if (keyIsDown(89))
        {
            let e = new ParticleEmitter(mousePosWorld);

            // test
            e.collideTiles = 1;
            //e.tileIndex=7;
            e.emitSize = 2;
            e.colorStartA = new Color(1,1,1,1);
            e.colorStartB = new Color(0,1,1,1);
            e.colorEndA = new Color(0,0,1,0);
            e.colorEndB = new Color(0,.5,1,0);
            e.emitConeAngle = .1;
            e.particleTime = 1
            e.speed = .3
            e.elasticity = .1
            e.gravityScale = 1;
            //e.additive = 1;
            e.angle = -PI;
        }

        if (mouseWheel) // mouse zoom
            cameraScale = clamp(cameraScale*(1-mouseWheel/10), defaultTileSize.x*16, defaultTileSize.x/16);
                    
        //if (keyWasPressed(77))
        //    playSong([[[,0,219,,,,,1.1,,-.1,-50,-.05,-.01,1],[2,0,84,,,.1,,.7,,,,.5,,6.7,1,.05]],[[[0,-1,1,0,5,0],[1,1,8,8,0,3]]],[0,0,0,0],90]) // music test

        if (keyWasPressed(77))
            players[0].pos = mousePosWorld;

        /*if (keyWasPressed(32))
        {
            skyParticles && skyParticles.destroy();
            tileLayer.destroy();
            tileBackgroundLayer.destroy();
            tileParallaxLayers.forEach((tileParallaxLayer)=>tileParallaxLayer.destroy());
            randomizeLevelParams();
            applyArtToLevel();
        }*/
        if (keyWasPressed(78))
            nextLevel();
    }

    // restart if no lives left
    let minDeadTime = 1e3;
    for(const player of players)
        minDeadTime = min(minDeadTime, player && player.isDead() ? player.deadTimer.get() : 0);

    if (keyWasPressed(82))
        resetGame(); // R always restarts immediately regardless of state (unchanged debug/quick-restart hotkey)
    else if (minDeadTime > 3 && (keyWasPressed(90) || keyWasPressed(32) || gamepadWasPressed(0)))
    {
        if (playerLives > 0)
            resetGame();
        else if (!gameOverShown)
        {
            // out of lives: show the professional Game Over screen instead of silently
            // restarting - only fires once per game-over (guarded until resetGame() clears it)
            gameOverShown = 1;
            showGameOverScreen();
        }
    }

    // level cleared (by the objective system or by the enemies-cleared fallback, both already
    // set levelEndTimer): show the Victory screen exactly once, the moment it happens, instead
    // of silently auto-advancing after a timer - NEXT LEVEL / REPLAY are now the player's choice
    if (levelEndTimer.isSet() && !victoryShown)
    {
        victoryShown = 1;
        showVictoryScreen();
    }
    else if (!levelEndTimer.isSet())
        victoryShown = 0;
},

///////////////////////////////////////////////////////////////////////////////
()=> // appUpdatePost
{
    if (players.length == 1)
    {
        const player = players[0];
        if (!player.isDead())
            cameraPos = cameraPos.lerp(player.pos, clamp(player.getAliveTime()/2));
    }
    else
    {
        // camera follows average pos of living players
        let posTotal = vec2();
        let playerCount = 0;
        let cameraOffset = 1;
        for(const player of players)
        {
            if (player && !player.isDead())
            {
                ++playerCount;
                posTotal = posTotal.add(player.pos.add(vec2(0,cameraOffset)));
            }
        }

        if (playerCount)
            cameraPos = cameraPos.lerp(posTotal.scale(1/playerCount), .2);
    }

    // spawn players if they don't exist
    for(let i = maxPlayers;i--;)
    {
        if (!players[i] && (gamepadWasPressed(0, i)||gamepadWasPressed(1, i)))
        {
            ++playerLives;
            new Player(checkpointPos, i);
        }
    }
    
    // clamp to bottom and sides of level
    if (clampCamera)
    {
        const w = mainCanvas.width/2/cameraScale+1;
        const h = mainCanvas.height/2/cameraScale+2;
        cameraPos.y = max(cameraPos.y, h);
        if (w*2 < tileCollisionSize.x)
            cameraPos.x = clamp(cameraPos.x, tileCollisionSize.x - w, w);
    }

    // camera shake (dash start, taking damage, dying)
    if (cameraShakeTimer.active())
    {
        const shakeFalloff = 1 - cameraShakeTimer.getPercent();
        cameraPos = cameraPos.add(randInCircle(cameraShakeMagnitude * shakeFalloff));
    }

    updateParallaxLayers();

    updateSky();
},

///////////////////////////////////////////////////////////////////////////////
()=> // appRender
{
    const gradient = mainContext.createLinearGradient(0,0,0,mainCanvas.height);
    gradient.addColorStop(0,levelSkyColor.rgba());
    gradient.addColorStop(1,levelSkyHorizonColor.rgba());
    mainContext.fillStyle = gradient;
    //mainContext.fillStyle = levelSkyColor.rgba();
    mainContext.fillRect(0,0,mainCanvas.width, mainCanvas.height);

    drawStars();
},

///////////////////////////////////////////////////////////////////////////////
()=> // appRenderPost
{
    //let minAliveTime = 9;
    //for(const player of players)
    //    minAliveTime = min(minAliveTime, player.getAliveTime());

    //const livesPercent = percent(minAliveTime, 5, 4)
    //const s = 8;
    //const offset = 100*livesPercent;
    //mainContext.drawImage(tileImage, 32, 8, s, s, 32, mainCanvas.height-90, s*9, s*9);
    mainContext.textAlign = 'center';
    const p = percent(gameTimer.get(), 8, 10);

    //mainContext.globalCompositeOperation = 'difference';
    mainContext.fillStyle = new Color(0,0,0,p).rgba();
    if (p > 0)
    {
        //mainContext.fillStyle = (new Color).setHSLA(time/3,1,.5,p).rgba();
        mainContext.font = '1.5in impact';
        mainContext.fillText('Battlefield', mainCanvas.width/2, 140);
    }

    mainContext.font = '.5in impact';
    p > 0 && mainContext.fillText('Defend. Destroy. Dominate.',mainCanvas.width/2, 210);

    // check if any enemies left
    let enemiesCount = 0;
    for (const o of engineCollideObjects)
    {
        if (o.isCharacter && o.team  == team_enemy)
        {
            ++enemiesCount;
            const pos = vec2(mainCanvas.width/2 + (o.pos.x - cameraPos.x)*30,mainCanvas.height-20);
            drawRectScreenSpace(pos, o.size.scale(20), o.color.scale(1,.6));
        }
    }

    if (!enemiesCount && !levelEndTimer.isSet())
        levelEndTimer.set();

    mainContext.fillStyle = new Color(0,0,0).rgba();
    isTouchDevice && (mainContext.font = '16px arial');
    mainContext.fillText('Level ' + level + '      Lives ' + playerLives + '      Enemies ' + enemiesCount + '      Score ' + score, mainCanvas.width/2, mainCanvas.height-40);

    // combo indicator while a kill-combo is still active, with a pop animation whenever it grows
    if (comboTimer.active() && comboCount > 1)
    {
        if (comboCount != lastDrawnCombo)
        {
            comboPopTimer.set(.25);
            lastDrawnCombo = comboCount;
        }
        const comboPop = comboPopTimer.active() ? 1 + .4*(1-comboPopTimer.getPercent()) : 1;

        mainContext.save();
        mainContext.translate(mainCanvas.width/2, mainCanvas.height-70);
        mainContext.scale(comboPop, comboPop);
        mainContext.fillStyle = '#ffcc00';
        mainContext.font = '.35in impact';
        mainContext.fillText('COMBO x' + comboCount, 0, 0);
        mainContext.restore();
    }

    // player HUD: animated health bar, stamina bar, dash cooldown bar
    players.forEach((player, i)=> player && !player.isDead() && drawPlayerHUD(player, i));

    // damage / death screen feedback (red flash + directional indicator, or fade to black on death)
    for (const player of players)
        player && drawDamageFeedback(player);

    // mission/objective HUD panel (top right), always visible
    drawObjectivePanel();

    // boss health bar (top center, only while a boss is alive) + random event notifications
    drawBossHealthBar();
    drawLevelEventNotification();

    // fade in level transition
    const fade = levelEndTimer.isSet() ? percent(levelEndTimer.get(), 3, 1) : percent(levelTimer.get(), .5, 2);
    drawRect(cameraPos, vec2(1e3), new Color(0,0,0,fade))
});