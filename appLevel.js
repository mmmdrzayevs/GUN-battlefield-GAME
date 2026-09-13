/*
    Javascript Space Game
    By aashuu  

*/

'use strict';

const tileType_ladder  = -1;
const tileType_empty   = 0;
const tileType_solid   = 1;
const tileType_dirt    = 2;
const tileType_base    = 3;
const tileType_pipeH   = 4;
const tileType_pipeV   = 5;
const tileType_glass   = 6;
const tileType_baseBack= 7;
const tileType_window  = 8;

const tileRenderOrder = -1e3;
const tileBackgroundRenderOrder = -2e3;

// level objects
let players=[], playerLives, tileLayer, tileBackgroundLayer, totalKills;

// score / combo / reward system - reset alongside totalKills in resetGame()
let score = 0, comboCount = 0, comboTimer = new Timer;
const comboWindow = 3; // seconds since the last combo-eligible score event that still extends it

// tracks kills that happen close together in time, for the separate multi-kill bonus below
let recentKillCount = 0, recentKillTimer = new Timer;
const multiKillWindow = 1; // seconds - several kills inside this window count as a "multi-kill"

// modular table of score sources - adding a new reward later just means adding an entry here
// and calling awardScore() with its key from wherever that event happens. comboEligible sources
// extend the on-screen combo counter and get its multiplier; one-off rewards (boss, objective)
// do not, since they aren't really part of a "kill chain".
const SCORE_SOURCES =
{
    enemyKill:     { base:10,  comboEligible:1 },
    multiKill:     { base:25,  comboEligible:0 }, // bonus layered on top of enemyKill
    explosiveKill: { base:15,  comboEligible:0 }, // bonus layered on top of enemyKill
    environmental: { base:20,  comboEligible:1 }, // enemy died to fire/hazard rather than a weapon
    bossKill:      { base:250, comboEligible:0 },
    objective:     { base:100, comboEligible:0 }, // e.g. clearing a level
    levelEvent:    { base:30,  comboEligible:0 }, // surviving/completing a random level event
};

// awards score from a named source, extending the combo if that source is combo-eligible, and
// spawns a floating "+N" popup at pos (if given). Returns the amount actually awarded.
function awardScore(sourceKey, pos, options={})
{
    const source = SCORE_SOURCES[sourceKey];
    if (!source)
        return 0; // unknown source key - fail safe instead of throwing, keeps this future-proof

    if (source.comboEligible)
    {
        comboCount = comboTimer.active() ? comboCount + 1 : 1;
        comboTimer.set(comboWindow);
    }

    const comboBonus = source.comboEligible ? 1 + (comboCount-1)*.25 : 1;
    const amount = Math.round(source.base * (options.multiplier || 1) * comboBonus);
    score += amount;

    pos && spawnScorePopup(pos, amount);
    return amount;
}

// awards score for an enemy kill, then detects and layers in multi-kill / explosive-kill /
// environmental-kill bonuses on top. Called from Enemy.kill() in appCharacters.js.
function addKillScore(enemy, damagingObject)
{
    const isBoss = enemy.isBig && enemy.type >= type_strong;
    const typeMultiplier = 1 + enemy.type*.5 + (enemy.isBig ? 1 : 0);
    awardScore(isBoss ? 'bossKill' : 'enemyKill', enemy.pos, {multiplier:typeMultiplier});

    // multi-kill: several enemies died within a short window of each other
    recentKillCount = recentKillTimer.active() ? recentKillCount+1 : 1;
    recentKillTimer.set(multiKillWindow);
    if (recentKillCount > 1)
        awardScore('multiKill', enemy.pos.add(vec2(0,.6)), {multiplier:recentKillCount-1});

    // explosive kill: this enemy was finished off by an explosion (see the explosionSource
    // marker object explosion() passes as damagingObject in appEffects.js)
    if (damagingObject && damagingObject.isExplosive)
        awardScore('explosiveKill', enemy.pos.add(vec2(0,-.6)));
    // environmental kill: no weapon/explosion involved, died while burning (fire spread, lava)
    else if (!damagingObject && enemy.burnTimer.isSet())
        awardScore('environmental', enemy.pos.add(vec2(0,-.6)));
}

///////////////////////////////////////////////////////////////////////////////
// mission/objective layer - sits entirely on top of the existing level generation and the
// existing "kill all enemies clears the level" flow (app.js still checks that on its own and
// still works exactly as before). An objective is just a small state-machine object:
// { type, state, data } where state moves active -> complete or active -> fail. Adding a new
// objective type later just means adding an entry to OBJECTIVE_TYPES with start()/update()/
// progressText() - nothing else needs to change.

const objectiveState_active   = 'active';
const objectiveState_complete = 'complete';
const objectiveState_fail     = 'fail';

let currentObjective = null;
let currentBoss = null; // set by the defeatBoss objective type; drives the HUD boss health bar
let levelTotalEnemies = 0;      // stable snapshot of the enemy count target, for "X/Y" progress
let levelCheckpoints = [];      // every Checkpoint created this level, in order
let levelPowerUpsCollected = 0; // incremented in applyPowerUp() (appCharacters.js)
let levelStartScore = 0, levelStartKills = 0, lastObjectiveReward = 0; // for the completion screen

function countLiveEnemies()
{
    let count = 0;
    for (const o of engineCollideObjects)
        if (o.isCharacter && o.team == team_enemy)
            ++count;
    return count;
}

// finds a raycast-validated ground position away from the player's start, for objective types
// that need to spawn something specific (a target to destroy, a boss to defeat). Reuses the
// exact same validation approach already used throughout level generation, just factored out
// so these two objective types don't need to duplicate it.
function findGroundSpawnPos(minCheckpointDistance = 20, tries = 30)
{
    for(let i = tries; i--;)
    {
        const pos = vec2(rand(levelSize.x-20, 20), levelSize.y);
        const raycastHit = tileCollisionRaycast(pos, vec2(pos.x, 0));
        if (raycastHit && abs(checkpointPos.x - raycastHit.x) > minCheckpointDistance)
            return raycastHit.add(vec2(0,2));
    }
    return 0; // could not find a valid spot - start() implementations must handle this
}

const OBJECTIVE_TYPES =
{
    killAll:
    {
        label: 'Eliminate all enemies',
        start(o) { o.data.total = levelTotalEnemies || 1; },
        update(o)
        {
            o.data.remaining = countLiveEnemies();
            if (o.data.remaining <= 0)
                o.state = objectiveState_complete;
        },
        progressText: o => 'Enemies: ' + (o.data.total-o.data.remaining) + '/' + o.data.total,
    },
    reachCheckpoint:
    {
        label: 'Reach the final checkpoint',
        start(o) { o.data.target = levelCheckpoints[levelCheckpoints.length-1]; },
        update(o)
        {
            if (o.data.target && activeCheckpoint === o.data.target)
                o.state = objectiveState_complete;
        },
        progressText: o => o.data.target ?
            'Checkpoint ' + (levelCheckpoints.indexOf(activeCheckpoint)+1) + '/' + levelCheckpoints.length : '',
    },
    survive:
    {
        label: 'Survive',
        start(o) { o.data.duration = 30 + level*2; },
        update(o)
        {
            if (levelTimer.get() >= o.data.duration)
                o.state = objectiveState_complete;
        },
        progressText: o => 'Time: ' + (min(levelTimer.get(),o.data.duration)|0) + '/' + o.data.duration + 's',
    },
    destroyTarget:
    {
        label: 'Destroy the marked target',
        start(o)
        {
            const pos = findGroundSpawnPos();
            if (!pos)
                return void (o.state = objectiveState_complete); // no valid spot - don't block progress
            o.data.target = new Prop(pos, propType_barrel_highExplosive);
            o.data.target.isObjectiveTarget = 1;
            o.data.target.additiveColor = new Color(1,.3,0,.3);
        },
        update(o)
        {
            if (!o.data.target || o.data.target.destroyed)
                o.state = objectiveState_complete;
        },
        progressText: o => o.data.target && !o.data.target.destroyed ? 'Target marked on the map' : '',
    },
    collect:
    {
        label: 'Collect power-ups',
        start(o) { o.data.target = 3 + (level > 3 ? 1 : 0); },
        update(o)
        {
            if (levelPowerUpsCollected >= o.data.target)
                o.state = objectiveState_complete;
        },
        progressText: o => 'Power-ups: ' + min(levelPowerUpsCollected,o.data.target) + '/' + o.data.target,
    },
    escape:
    {
        label: 'Escape to the far side of the level',
        start(o) { o.data.timeLimit = 60; },
        update(o)
        {
            for (const player of players)
                if (player && !player.isDead() && player.pos.x > tileCollisionSize.x - 6)
                    o.state = objectiveState_complete;
            if (o.state == objectiveState_active && levelTimer.get() > o.data.timeLimit)
                o.state = objectiveState_fail;
        },
        progressText: o => 'Time left: ' + (max(o.data.timeLimit-levelTimer.get(),0)|0) + 's',
    },
    defeatBoss:
    {
        label: 'Defeat the boss',
        start(o)
        {
            const pos = findGroundSpawnPos();
            if (!pos)
                return void (o.state = objectiveState_complete); // no valid spot - don't block progress
            o.data.boss = currentBoss = new Boss(pos);
        },
        update(o)
        {
            if (!o.data.boss || o.data.boss.isDead())
                o.state = objectiveState_complete;
        },
        progressText: o => o.data.boss && !o.data.boss.isDead() ?
            'Boss HP: ' + Math.ceil(o.data.boss.health) + '/' + (o.data.boss.healthMax|0) : '',
    },
};
const OBJECTIVE_TYPE_KEYS = Object.keys(OBJECTIVE_TYPES);

function chooseObjectiveType()
{
    // ease players into it: the first couple of levels always use the familiar "kill everyone"
    // goal, then a random type is picked - killAll always remains available as a side-effect
    // fallback too, since clearing every enemy still ends the level regardless of objective
    return level < 3 ? 'killAll' : OBJECTIVE_TYPE_KEYS[randSeeded(OBJECTIVE_TYPE_KEYS.length)|0];
}

// called once from nextLevel(), after the level is fully generated and the player has spawned
function startObjective()
{
    const type = chooseObjectiveType();
    currentObjective = { type, state:objectiveState_active, data:{} };
    OBJECTIVE_TYPES[type].start(currentObjective);
    spawnObjectiveStartEffect();
    playSound(sound_objectiveStart, cameraPos);
}

// called every frame from app.js's appUpdate()
function updateObjective()
{
    if (!currentObjective || currentObjective.state != objectiveState_active)
        return;

    OBJECTIVE_TYPES[currentObjective.type].update(currentObjective);

    if (currentObjective.state == objectiveState_complete)
        onObjectiveComplete();
    else if (currentObjective.state == objectiveState_fail)
        onObjectiveFail();
}

function onObjectiveComplete()
{
    lastObjectiveReward = awardScore('objective', cameraPos);
    spawnObjectiveCompleteEffect(cameraPos);
    playSound(sound_objectiveComplete, cameraPos);

    // an additional way to clear the level, on top of (not instead of) the existing "all
    // enemies dead" check in app.js - that check is untouched and still works on its own,
    // whichever condition happens first just wins since both guard on levelEndTimer.isSet()
    if (!levelEndTimer.isSet())
        levelEndTimer.set();
}

function onObjectiveFail()
{
    spawnObjectiveFailEffect(cameraPos);
    playSound(sound_objectiveFail, cameraPos);
    // failing an objective does not end the level or cost a life - killing all enemies remains
    // the always-available fallback way to clear the level
}

///////////////////////////////////////////////////////////////////////////////
// random level events - a second, independent modular layer on top of the same level/enemy/
// particle systems (separate from the mission objective above: a level can have an objective
// AND randomly roll into an event mid-level). Adding a new event later just means adding an
// entry to LEVEL_EVENT_TYPES; nothing else needs to change. Only one event runs at a time.

let currentLevelEvent = null;
let nextLevelEventTimer = new Timer;

const LEVEL_EVENT_TYPES =
{
    enemyWave:
    {
        label: 'Enemy Wave Incoming!',
        duration: 0, // "instant" events just do their thing once in start() and immediately end
        start(e)
        {
            let spawned = 0;
            for(let i = 5+(level>5?2:0); i--;)
            {
                const pos = findGroundSpawnPos(10);
                if (pos)
                    new Enemy(pos), ++spawned;
            }
            levelTotalEnemies += spawned; // keep the killAll objective's "X/Y" progress accurate
        },
    },
    heavyRain:
    {
        label: 'Heavy Rain',
        duration: 20,
        start(e)
        {
            // integrates directly with the existing precipitation system rather than creating
            // a parallel one - just temporarily cranks up the same skyParticles emitter
            if (skyParticles)
            {
                e.data.prevRate = skyParticles.emitRate;
                e.data.prevRain = skyRain;
                skyRain = 1;
                skyParticles.emitRate = 800;
            }
        },
        end(e)
        {
            if (skyParticles)
            {
                skyParticles.emitRate = e.data.prevRate;
                skyRain = e.data.prevRain;
            }
        },
    },
    explosionEvent:
    {
        label: 'Incoming Explosions!',
        duration: 4,
        start(e) { e.data.count = 0; e.data.timer = new Timer; },
        update(e)
        {
            if (e.data.count < 5 && e.data.timer.elapsed())
            {
                const pos = findGroundSpawnPos(6);
                pos && explosion(pos, rand(2.5,1.5));
                e.data.timer.set(rand(.7,.3));
                ++e.data.count;
            }
        },
    },
    supplyDrop:
    {
        label: 'Supply Drop Incoming',
        duration: 0,
        start(e)
        {
            for(let i = 2+(level>5?1:0); i--;)
            {
                const pos = findGroundSpawnPos(5);
                // spawns directly rather than through trySpawnPowerUp() - this is a guaranteed
                // reward drop, not ambient random spawning, so it skips those spacing/chance gates
                pos && new PowerUp(pos, POWERUP_TYPE_KEYS[rand(POWERUP_TYPE_KEYS.length)|0]);
            }
        },
    },
    eliteSpawn:
    {
        label: 'Elite Enemy Spawn',
        duration: 0,
        start(e)
        {
            const pos = findGroundSpawnPos();
            if (pos)
            {
                const enemy = new Enemy(pos);
                enemy.type = type_elite;
                enemy.isBig = 1;
                enemy.health = enemy.healthMax *= 1.5;
                ++levelTotalEnemies;
            }
        },
    },
    ambush:
    {
        label: 'Ambush!',
        duration: 0,
        start(e)
        {
            for(const player of players)
            {
                if (!player || player.isDead())
                    continue;
                for(let i = 3; i--;)
                {
                    const pos = player.pos.add(vec2(randSign()*rand(10,6), 3));
                    const enemy = new Enemy(pos);
                    enemy.alert(player.pos, 1); // spawns already alerted, no sneaking up needed
                    ++levelTotalEnemies;
                }
            }
        },
    },
};
const LEVEL_EVENT_TYPE_KEYS = Object.keys(LEVEL_EVENT_TYPES);

// called every frame from app.js's appUpdate()
function updateLevelEvents()
{
    if (levelWarmup || levelEndTimer.isSet())
        return; // don't roll/run events while a level is settling in or already ending

    if (currentLevelEvent)
    {
        const def = LEVEL_EVENT_TYPES[currentLevelEvent.type];
        def.update && def.update(currentLevelEvent);
        if (currentLevelEvent.duration && time - currentLevelEvent.startTime > currentLevelEvent.duration)
            endLevelEvent();
        return;
    }

    if (nextLevelEventTimer.elapsed())
    {
        nextLevelEventTimer.set(rand(45,25)); // schedule the next possible event window
        if (rand() < .6) // not every window actually triggers one
            startLevelEvent(LEVEL_EVENT_TYPE_KEYS[rand(LEVEL_EVENT_TYPE_KEYS.length)|0]);
    }
}

function startLevelEvent(type)
{
    const def = LEVEL_EVENT_TYPES[type];
    currentLevelEvent = { type, data:{}, startTime:time, duration:def.duration };
    def.start(currentLevelEvent);

    levelEventNotificationText = def.label;
    levelEventNotificationTimer.set(3);
    playSound(sound_levelEvent, cameraPos);

    if (!def.duration)
        endLevelEvent(); // "instant" events (spawn/drop-style) are done as soon as start() runs
}

function endLevelEvent()
{
    const def = LEVEL_EVENT_TYPES[currentLevelEvent.type];
    def.end && def.end(currentLevelEvent);
    awardScore('levelEvent', cameraPos);
    currentLevelEvent = null;
}

let levelEventNotificationText = '', levelEventNotificationTimer = new Timer;

///////////////////////////////////////////////////////////////////////////////

// level settings
let levelSize, level, levelSeed, levelEnemyCount, levelWarmup;
let levelColor, levelBackgroundColor, levelSkyColor, levelSkyHorizonColor, levelGroundColor;
let skyParticles, skyRain, skySoundTimer = new Timer;
let gameTimer = new Timer, levelTimer = new Timer, levelEndTimer = new Timer;

let tileBackground;
const setTileBackgroundData = (pos, data=0)=>
    pos.arrayCheck(tileCollisionSize) && (tileBackground[(pos.y|0)*tileCollisionSize.x+pos.x|0] = data);
const getTileBackgroundData = (pos)=>
    pos.arrayCheck(tileCollisionSize) ? tileBackground[(pos.y|0)*tileCollisionSize.x+pos.x|0] : 0;

///////////////////////////////////////////////////////////////////////////////
// power-up spawning - reuses whatever ground position the caller already validated (every call
// site below comes from a spot already confirmed reachable via tileCollisionRaycast, same as
// prop/enemy spawning), and only adds the constraints power-ups specifically need: not too close
// to the player's start, and not clustered on top of another power-up already placed this level.
let levelPowerUpPositions = []; // reset per level in generateLevel()
const powerUpMinSpacing = 12;   // minimum distance between two power-ups on the same level

function trySpawnPowerUp(pos, chance, minCheckpointDistance = 15)
{
    if (rand() > chance)
        return 0;
    if (abs(checkpointPos.x - pos.x) < minCheckpointDistance)
        return 0; // too close to where the player starts
    for (const p of levelPowerUpPositions)
        if (pos.distanceSquared(p) < powerUpMinSpacing**2)
            return 0; // too close to a power-up already placed this level

    new PowerUp(pos, POWERUP_TYPE_KEYS[rand(POWERUP_TYPE_KEYS.length)|0]);
    levelPowerUpPositions.push(pos.copy());
    return 1;
}

///////////////////////////////////////////////////////////////////////////////
// level generation

const resetGame=()=>
{
    levelEndTimer.unset();
    gameTimer.set(totalKills = level = score = comboCount = recentKillCount = 0);
    comboTimer.unset();
    recentKillTimer.unset();
    currentObjective = null;
    gameOverShown = 0;
    nextLevel(playerLives = 6);
}

function buildTerrain(size)
{
    tileBackground = [];
    initTileCollision(size);
    let startGroundLevel = rand(40, 60);
    let groundLevel = startGroundLevel;
    let groundSlope = rand(.5,-.5);
    let canayonWidth = 0, backgroundDelta = 0, backgroundDeltaSlope = 0;
    for(let x=0; x < size.x; x++)
    {
        // pull slope towards start ground level
        groundLevel += groundSlope = rand() < .05 ? rand(.5,-.5) :
            groundSlope + (startGroundLevel - groundLevel)/1e3;
        
        // small jump
        if (rand() < .04)
            groundLevel += rand(9,-9);

        if (rand() < .03)
        {
            // big jump
            const jumpDelta = rand(9,-9);
            startGroundLevel = clamp(startGroundLevel + jumpDelta, 80, 20);
            groundLevel += jumpDelta;
            groundSlope = rand(.5,-.5);
        }

        --canayonWidth;
        if (rand() < .005)
            canayonWidth = rand(7, 2);

        backgroundDelta += backgroundDeltaSlope;
        if (rand() < .1)
            backgroundDelta = rand(3, -1);
        if (rand() < .1)
            backgroundDelta = 0;
        if (rand() < .1)
            backgroundDeltaSlope = rand(1,-1);
        backgroundDelta = clamp(backgroundDelta, 3, -1)

        groundLevel = clamp(groundLevel, 99, 30);
        for(let y=0; y < size.y; y++)
        {
            const pos = vec2(x,y);

            let frontTile = tileType_empty;
            if (y < groundLevel && canayonWidth <= 0)
                 frontTile = tileType_dirt;

            let backTile = tileType_empty;
            if (y < groundLevel + backgroundDelta)
                 backTile = tileType_dirt;
            
            setTileCollisionData(pos, frontTile);
            setTileBackgroundData(pos, backTile);
        }
    }

    // add random holes
    for(let i=levelSize.x; i--;)
    {
        const pos = vec2(rand(levelSize.x), rand(levelSize.y-19, 19));
        for(let x = rand(9,1)|0;--x;)
        for(let y = rand(9,1)|0;--y;)
            setTileCollisionData(pos.add(vec2(x,y)), tileType_empty);
    }
}

function spawnProps(pos)
{
    if (abs(checkpointPos.x-pos.x) > 5)
    {
        new Prop(pos);
        const propPlaceSize = .51;
        if (randSeeded() < .2)
        {
            // 3 triangle prop stack
            new Prop(pos.add(vec2(propPlaceSize*2,0)));
            if (randSeeded() < .2)
                new Prop(pos.add(vec2(propPlaceSize,propPlaceSize*2)));
        }
        else if (randSeeded() < .2)
        {
            // 3 column prop stack
            new Prop(pos.add(vec2(0,propPlaceSize*2)));
            if (randSeeded() < .2)
                new Prop(pos.add(vec2(0,propPlaceSize*4)));
        }
    }
}

function buildBase()
{
    let raycastHit;
    for(let tries=99;!raycastHit;)
    {
        if (!tries--)
            return 1; // count not find pos

        const pos = vec2(randSeeded(levelSize.x-40,40), levelSize.y);

        // must not be near player start
        if (abs(checkpointPos.x-pos.x) > 30)
            raycastHit = tileCollisionRaycast(pos, vec2(pos.x, 0));
    }

    const cave = rand() < .5;
    const baseBottomCenterPos = raycastHit.int();
    const baseSize = randSeeded(20,9)|0;
    const baseFloors = cave? 1 : randSeeded(6,1)|0;
    const basementFloors = randSeeded(cave?7:4, 0)|0;
    let floorBottomCenterPos = baseBottomCenterPos.subtract(vec2(0,basementFloors*6));
    floorBottomCenterPos.y = max(floorBottomCenterPos.y, 9); // prevent going through bottom

    let floorWidth = baseSize;
    let previousFloorHeight = 0;
    for(let floor=-basementFloors; floor <= baseFloors; ++floor)
    {  
        const topFloor = floor == baseFloors;
        const groundFloor = !floor;
        const isCaveFloor = cave ? rand() < .8 | (floor == 0 && rand() < .6): 0;
        let floorHeight = isCaveFloor ? randSeeded(9,2)|0 : topFloor? 0 : groundFloor? randSeeded(9,4)|0 : randSeeded(7,2)|0;
        const floorSpace = topFloor ? 4 : max(floorHeight - 1, 0);

        let backWindow = rand() < .5;
        const windowTop = rand(4,2);

        for(let x=-floorWidth; x <= floorWidth; ++x)
        {
            const isWindow = !isCaveFloor && randSeeded() < .3;
            const hasSide = !isCaveFloor && randSeeded() < .9;

            if (cave)
                backWindow = 0;
            else if (rand() < .1)
                backWindow = !backWindow;

            if (cave && rand() < .2)
                floorHeight = clamp(floorHeight + rand(3,-3)|0, 9, 2)

            for(let y=-1; y < floorHeight; ++y)
            {
                const pos = floorBottomCenterPos.add(vec2(x,y));
                let foregroundTile = tileType_empty;
                if (isCaveFloor)
                {
                    // add ceiling and floor
                    if ( y < 0 | y == floorHeight-1)
                        foregroundTile = tileType_dirt;

                    setTileBackgroundData(pos, tileType_dirt);
                    setTileCollisionData(pos, foregroundTile);
                }
                else
                {
                    // add ceiling and floor
                    const isHorizontal = y < 0 | y == floorHeight-1;
                    if (isHorizontal)
                        foregroundTile = tileType_pipeH;

                    // add walls and windows
                    if (abs(x) == floorWidth)
                        foregroundTile = isHorizontal ? tileType_base : isWindow ? tileType_glass : tileType_pipeV;

                    let backgroundTile = foregroundTile>0||floorHeight<3? tileType_baseBack : tileType_base;
                    if (backWindow && y > 0 && y < floorHeight-windowTop && abs(x) < floorWidth-2)
                        backgroundTile = tileType_window;

                    setTileBackgroundData(pos, backgroundTile);
                    setTileCollisionData(pos, foregroundTile);
                }
            }
        }

        // add ladders to floor below
        if (!cave || !topFloor)
        for(let ladderCount=randSeeded(2)+1|0;ladderCount--;)
        {
            const x = randSeeded(floorWidth-1, -floorWidth+1)|0;
            const pos = floorBottomCenterPos.add(vec2(x,-2));

            let y=0;
            let hitBottom = 0;
            for(; y < levelSize.y; ++y)
            {
                const pos = floorBottomCenterPos.add(vec2(x,-y-1));
                if (pos.y < 2)
                {
                    // hit bottom, no ladder
                    break;
                }
                if (y && getTileCollisionData(pos) > 0 && getTileCollisionData(pos.add(vec2(0,1))) <= 0 )
                {
                    for(;y--;)
                    {
                        const pos = floorBottomCenterPos.add(vec2(x,-y-1));
                        setTileCollisionData(pos, tileType_ladder);
                    }
                    break;
                }
            }
        }

        // spawn crates
        const propCount = randSeeded(floorWidth/2)|0;
        for(let i = propCount; i--;)
            spawnProps(floorBottomCenterPos.add(vec2(randSeeded( floorWidth-2,-floorWidth+2),.5)));

        // occasional power-up on this floor, same validated ground position as the crates above
        trySpawnPowerUp(floorBottomCenterPos.add(vec2(randSeeded(floorWidth-2,-floorWidth+2),.5)), .08);

        if (topFloor || floorSpace > 1)
        {
            // spawn enemies
            for(let i = propCount; i--;)
            {
                const pos = floorBottomCenterPos.add(vec2(randSeeded( floorWidth-1,-floorWidth+1),.7));
                new Enemy(pos);
            }
        }

        const oldFloorWidth = floorWidth;
        floorWidth = max(floorWidth + randSeeded(8,-8),9)|0;
        floorBottomCenterPos.y += floorHeight;
        floorBottomCenterPos.x += randSeeded(oldFloorWidth - floorWidth+1)|0;
        previousFloorHeight = floorHeight;
    }

    //checkpointPos = floorBottomCenterPos.copy(); // start player on base for testing

    // spawn random enemies and props
    for(let i=20;levelEnemyCount>0&&i--;)
    {
        const pos = vec2(floorBottomCenterPos.x + randSeeded(99, -99), levelSize.y);
        raycastHit = tileCollisionRaycast(pos, vec2(pos.x, 0));
        // must not be near player start
        if (raycastHit && abs(checkpointPos.x-pos.x) > 20)
        {
            const pos = raycastHit.add(vec2(0,2));
            if (!trySpawnPowerUp(pos, .1))
                randSeeded() < .7 ? new Enemy(pos) : spawnProps(pos);
        }
    }
}

function generateLevel()
{
    levelEndTimer.unset();
    levelPowerUpPositions = [];
    levelCheckpoints = [];
    levelPowerUpsCollected = 0;
    currentBoss = null;
    currentLevelEvent = null;
    nextLevelEventTimer.set(rand(30,15)); // first event window of the level comes a bit sooner

    // remove all objects that are not persistnt or are descendants of something persitant
    for(const o of engineObjects)
        o.destroy();
    engineObjects = [];
    engineCollideObjects = [];

    // randomize ground level hills
    buildTerrain(levelSize);

    // find starting poing for player
    let raycastHit;
    for(let tries=99;!raycastHit;)
    {
        if (!tries--)
            return 1; // count not find pos

        // start on either side of level
        checkpointPos = vec2(levelSize.x/2 + (levelSize.x/2-10-randSeeded(9))*(randSeeded()<.5?-1:1) | 0, levelSize.y);
        raycastHit = tileCollisionRaycast(checkpointPos, vec2(checkpointPos.x, 0));
    }
    checkpointPos = raycastHit.add(vec2(0,1));

    // random bases until there enough enemies
    for(let tries=99;levelEnemyCount>0;)
    {
        if (!tries--)
            return 1; // count not spawn enemies

        if (buildBase())
            return 1;
    }

    // build checkpoints
    for(let x=0; x<levelSize.x-9; )
    {
        x += rand(100,70);
        const pos = vec2(x, levelSize.y);
        raycastHit = tileCollisionRaycast(pos, vec2(pos.x, 0));
        // must not be near player start
        if (raycastHit && abs(checkpointPos.x-pos.x) > 50)
        {
            // todo prevent overhangs
            const pos = raycastHit.add(vec2(0,1));
            levelCheckpoints.push(new Checkpoint(pos));
        }
    }
}

const groundTileStart = 8;

function makeTileLayers(level_)
{
    // create foreground layer
    tileLayer = new TileLayer(vec2(), levelSize);
    tileLayer.renderOrder = tileRenderOrder;

    // create background layer
    tileBackgroundLayer = new TileLayer(vec2(), levelSize);
    tileBackgroundLayer.renderOrder = tileBackgroundRenderOrder;

    for(let x=levelSize.x;x--;)
    for(let y=levelSize.y;y--;)
    {
        const pos = vec2(x,y);
        let tileType = getTileCollisionData(pos);
        if (tileType)
        {
            // todo pick tile, direction etc based on neighbors tile type
            let direction = rand(4)|0
            let mirror = rand(2)|0;
            let color;

            let tileIndex = groundTileStart;
            if (tileType == tileType_dirt)
            {
                tileIndex = groundTileStart+2 + rand()**3*2|0;
                color = levelColor.mutate(.03);
            }
            else if (tileType == tileType_pipeH)
            {
                tileIndex = groundTileStart+5;
                direction = 1;
            }
            else if (tileType == tileType_pipeV)
            {
                tileIndex = groundTileStart+5;
                direction = 0;
            }
            else if (tileType == tileType_glass)
            {
                tileIndex = groundTileStart+5;
                direction = 0;
                color = new Color(0,1,1,.5);
            }
            else if (tileType == tileType_base)
                tileIndex = groundTileStart+4;
            else if (tileType == tileType_ladder)
            {
                tileIndex = groundTileStart+7;
                direction = mirror = 0;
            }
            tileLayer.setData(pos, new TileLayerData(tileIndex, direction, mirror, color));
        }
        
        tileType = getTileBackgroundData(pos);
        if (tileType)
        {
            // todo pick tile, direction etc based on neighbors tile type
            const direction = rand(4)|0
            const mirror = rand(2)|0;
            let color = new Color();

            let tileIndex = groundTileStart;
            if (tileType == tileType_dirt)
            {
                tileIndex = groundTileStart +2 + rand()**3*2|0;
                color = levelColor.mutate();
            }
            else if (tileType == tileType_base)
            {
                tileIndex = groundTileStart+6;
                color = color.scale(rand(1,.7),1)
            }
            else if (tileType == tileType_baseBack)
            {
                tileIndex = groundTileStart+6;
                color = color.scale(rand(.5,.3),1).mutate();
            }
            else if (tileType == tileType_window)
            {
                tileIndex = 0;
                color = new Color(0,1,1,.5);
            }
            tileBackgroundLayer.setData(pos, new TileLayerData(tileIndex, direction, mirror, color.scale(.4,1)));
        }
    }
    tileLayer.redraw();
    tileBackgroundLayer.redraw();
}

function applyArtToLevel()
{
    makeTileLayers();
    
    // apply decoration to level tiles
    for(let x=levelSize.x;x--;)
    for(let y=levelSize.y;--y;)
    {
        decorateBackgroundTile(vec2(x,y));
        decorateTile(vec2(x,y));
    }

    generateParallaxLayers();

    if (precipitationEnable && !lowGraphicsSettings)
    {
        // create rain or snow particles
        if (skyRain = rand() < .5)
        {
            // rain
            skyParticles = new ParticleEmitter(
                vec2(), 3, 0, 0, .3, // pos, emitSize, emitTime, emitRate, emiteCone
                0, undefined,   // tileIndex, tileSize
                new Color(.8,1,1,.6), new Color(.5,.5,1,.2), // colorStartA, colorStartB
                new Color(.8,1,1,.6), new Color(.5,.5,1,.2), // colorEndA, colorEndB
                2, .1, .1, .2, 0,  // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
                .99, 1, .5, PI, .2,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
                .5, 1              // randomness, collide, additive, randomColorLinear, renderOrder
            );
            skyParticles.elasticity = .2;
            skyParticles.trailScale = 2;
        }
        else
        {
            // snow
            skyParticles = new ParticleEmitter(
                vec2(), 3, 0, 0, .5, // pos, emitSize, emitTime, emitRate, emiteCone
                0, undefined,   // tileIndex, tileSize
                new Color(1,1,1,.8), new Color(1,1,1,.2), // colorStartA, colorStartB
                new Color(1,1,1,.8), new Color(1,1,1,.2), // colorEndA, colorEndB
                3, .1, .1, .3, .01,  // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
                .98, 1, .2, PI, .2,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
                .5, 1              // randomness, collide, additive, randomColorLinear, renderOrder
            );
        }
        skyParticles.emitRate = precipitationEnable && rand()<.5 ? rand(500) : 0;
        skyParticles.angle = PI+rand(.5,-.5);
    }
}

function nextLevel()
{
    playerLives += 4; // three for beating a level plus 1 for respawning
    levelTotalEnemies = levelEnemyCount = 15 + min(level * 30, 300);
    ++level;
    levelSeed = randSeed = rand(1e9)|0;
    levelSize = vec2(min(level*99,400),200);
    levelColor = randColor(new Color(.2,.2,.2), new Color(.8,.8,.8));
    levelSkyColor = randColor(new Color(.5,.5,.5), new Color(.9,.9,.9));
    levelSkyHorizonColor = levelSkyColor.subtract(new Color(.05,.05,.05)).mutate(.3).clamp();
    levelGroundColor = levelColor.mutate().add(new Color(.3,.3,.3)).clamp();

    // keep trying until a valid level is generated
    for(;generateLevel(););

    // warm up level
    levelWarmup = 1;

    // objects that effect the level must be added here
    const firstCheckpoint = new Checkpoint(checkpointPos).setActive();
    levelCheckpoints.unshift(firstCheckpoint);

    applyArtToLevel();

    const warmUpTime = 2;
    for(let i=warmUpTime * FPS; i--;)
    {
        updateSky();
        engineUpdateObjects();
    }
    levelWarmup = 0;

    // destroy any objects that are stuck in collision
    forEachObject(0, 0, (o)=>
    {
        if (o.isGameObject && o != firstCheckpoint)
        {
            const checkBackground = o.isCheckpoint;
            (checkBackground ? getTileBackgroundData(o.pos) > 0 : tileCollisionTest(o.pos,o.size))  && o.destroy();
        }
    });

    // hack, subtract off warm up time from main game timer
    //gameTimer.time += warmUpTime;
    levelTimer.set();

    // spawn player
    players = [];
    new Player(checkpointPos);
    //new Enemy(checkpointPos.add(vec2(3))); // test enemy

    // mission/objective layer + completion-screen baseline stats for this level
    levelStartScore = score;
    levelStartKills = totalKills;
    lastObjectiveReward = 0;
    startObjective();
}