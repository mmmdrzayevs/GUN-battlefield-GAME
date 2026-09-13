/*
    Javascript Space Game
    By aashuu  

*/

'use strict';

const aiEnable = 1;
const debugAI = 0;
const maxCharacterSpeed = .2;

// sprint / stamina settings
const sprintSpeedMultiplier = 1.8; // how much faster sprinting is than normal max speed
const sprintAccelMultiplier = 1.3; // how much faster sprinting accelerates
const staminaMax             = 3;  // seconds of sprint available
const staminaDrainRate       = 1;  // stamina used per second while sprinting
const staminaRegenRate       = .5; // stamina regenerated per second while resting
const staminaRegenDelay      = .5; // delay after releasing sprint before regen starts

class Character extends GameObject 
{
    constructor(pos, sizeScale = 1) 
    { 
        super(pos, vec2(.6,.95).scale(sizeScale), 32);

        this.health = this.healthMax = this.canBurn = this.isCharacter = 1;
        this.sizeScale = sizeScale;
        this.groundTimer = new Timer;
        this.jumpTimer = new Timer;
        this.pressedJumpTimer = new Timer;
        this.preventJumpTimer = new Timer;
        this.dodgeTimer = new Timer;
        this.dodgeRechargeTimer = new Timer;
        this.dodgeDirection = vec2(); // direction of the current/last dash
        this.sprinting = 0;           // only ever set true on Player, harmless default for Enemy
        this.deadTimer = new Timer;
        this.blinkTimer = new Timer;
        this.moveInput = vec2();
        this.extraAdditiveColor = new Color(0,0,0,0);
        this.color = new Color;
        this.eyeColor = new Color;
        this.bodyTile = 3;
        this.headTile = 2;
        this.renderOrder = 10;
        this.overkill = this.grenadeCount = this.walkCyclePercent = 0;
        this.grendeThrowTimer = new Timer;
        this.setCollision();
    }
    
    update() 
    {
        this.lastPos = this.pos.copy();
        this.gravityScale = 1; // reset default gravity (incase climbing ladder)

        if (this.isDead() || !this.inUpdateWindow() && !this.persistent)
        {
            super.update();
            return; // ignore offscreen objects
        }
            
        let moveInput = this.moveInput.copy();

        // allow grabbing ladder at head or feet
        let touchingLadder = 0;
        for(let y=2;y--;)
        {
            const testPos = this.pos.add(vec2(0, y + .1*this.moveInput.y - this.size.y*.5));
            const collisionData = getTileCollisionData(testPos);
            touchingLadder |= collisionData == tileType_ladder;
        }
        if (!touchingLadder)
            this.climbingLadder = 0;
        else if (this.moveInput.y)
            this.climbingLadder = 1;

        if (this.dodgeTimer.active())
        {
            // update roll
            this.angle = this.getMirrorSign(2*PI*this.dodgeTimer.getPercent());

            if (this.groundObject)
                this.velocity.x += this.getMirrorSign(.1);

            // sustain the dash speed along its initial direction while it lasts
            // (collision/physics still fully apply via the normal super.update() below,
            // so the dash cannot pass through walls or solid objects)
            this.velocity = this.velocity.add(this.dodgeDirection.scale(.03));

            // apply damage to enemies when rolling
            forEachObject(this.pos, this.size, (o)=>
            {
                if (o.isCharacter && o.team != this.team && !o.isDead())
                    o.damage(1, this);
            });
        }
        else
            this.angle = 0;

        if (this.climbingLadder)
        {
            this.gravityScale = this.climbingWall = this.groundObject = 0;
            this.jumpTimer.unset();
            this.groundTimer.unset();
            this.velocity = this.velocity.multiply(vec2(.85)).add(vec2(0,.02*moveInput.y));

            const delta = (this.pos.x|0)+.5 - this.pos.x;
            this.velocity.x += .02*delta*abs(moveInput.x ? 0:moveInput.y);
            moveInput.x *= .2;

            // exit ladder if ground is below
            this.climbingLadder = moveInput.y >= 0 || getTileCollisionData(this.pos.subtract(vec2(0,1))) <= 0;
        }
        else
        {
            // update jumping and ground check
            if (this.groundObject || this.climbingWall)
                this.groundTimer.set(.1);

            if (this.groundTimer.active() && !this.dodgeTimer.active())
            {
                // is on ground
                if (this.pressedJumpTimer.active() 
                    && !this.jumpTimer.active() 
                    && !this.preventJumpTimer.active())
                {
                    // start jump
                    if (this.climbingWall)
                    {
                        this.velocity.y = .25;
                    }
                    else
                    {
                        this.velocity.y = .15;
                        this.jumpTimer.set(.2);
                    }
                    this.preventJumpTimer.set(.5);
                    playSound(sound_jump, this.pos);
                }
            }

            if (this.jumpTimer.active() && !this.climbingWall)
            {
                // update variable height jump
                this.groundTimer.unset();
                if (this.holdingJump && this.velocity.y > 0 && this.jumpTimer.active())
                    this.velocity.y += .017;
            }

            if (!this.groundObject)
            {
                // air control
                if (sign(moveInput.x) == sign(this.velocity.x))
                    moveInput.x *= .1; // moving with velocity
                else
                    moveInput.x *= .2; // moving against velocity (stopping)
                
                // slight extra gravity when moving down
                if (this.velocity.y < 0)
                    this.velocity.y += gravity*.2;
            }
        }

        if (this.pressedDodge && !this.dodgeTimer.active() && !this.dodgeRechargeTimer.active())
        {
            // start dash/dodge
            this.dodgeTimer.set(.4);
            this.dodgeRechargeTimer.set(2);
            this.jumpTimer.unset();
            this.extinguish();
            playSound(sound_dodge, this.pos);

            if (!this.groundObject && this.getAliveTime() > .2)
                this.velocity.y += .2;

            // dash in the direction of movement input, falling back to facing direction
            this.dodgeDirection = moveInput.lengthSquared() > .01 ?
                moveInput.normalize() : vec2(this.getMirrorSign(1), 0);
            this.velocity = this.velocity.add(this.dodgeDirection.scale(.35));

            // dash visual/camera feedback (particle trail for everyone, shake only for the player)
            makeDashEffect(this.pos, this.dodgeDirection.angle());
            this.isPlayer && shakeCamera(.15, .15);
        }

        // apply movement acceleration and clamp (skipped mid-dash so the dash burst isn't clamped away)
        if (!this.dodgeTimer.active())
        {
            const speedMultiplier = (this.sprinting ? sprintSpeedMultiplier : 1) * (this.speedMult || 1);
            const accelMultiplier = (this.sprinting ? sprintAccelMultiplier : 1) * (this.speedMult || 1);
            this.velocity.x = clamp(this.velocity.x + moveInput.x * .042 * accelMultiplier,
                maxCharacterSpeed * speedMultiplier, -maxCharacterSpeed * speedMultiplier);
        }

        // call parent, update physics
        const oldVelocity = this.velocity.copy();
        super.update();
        if (!this.isPlayer && !this.dodgeTimer.active())
        {
            // apply collision damage
            const deltaSpeedSquared = this.velocity.subtract(oldVelocity).lengthSquared();
            deltaSpeedSquared > .1 && this.damage(10*deltaSpeedSquared);
        }

        if (this.climbingLadder || this.groundTimer.active() && !this.dodgeTimer.active())
        {
            const speed = this.velocity.length();
            this.walkCyclePercent += speed * .5;
            this.walkCyclePercent = speed > .01 ? mod(this.walkCyclePercent, 1) : 0;
        }
        else
            this.walkCyclePercent = 0;

        this.weapon.triggerIsDown = this.holdingShoot && !this.dodgeTimer.active();
        if (!this.dodgeTimer.active())
        {
            if (this.grenadeCount > 0 && this.pressingThrow && !this.wasPressingThrow && !this.grendeThrowTimer.active())
            {
                // throw greande
                --this.grenadeCount;
                const grenade = new Grenade(this.pos);
                grenade.velocity = this.velocity.add(vec2(this.getMirrorSign(),rand(.8,.7)).normalize(.25+rand(.02)));
                grenade.angleVelocity = this.getMirrorSign() * rand(.8,.5);
                playSound(sound_jump, this.pos);
                this.grendeThrowTimer.set(1);
            }
            this.wasPressingThrow = this.pressingThrow;
        }

        // update mirror
        if (this.moveInput.x && !this.dodgeTimer.active())
            this.mirror = this.moveInput.x < 0;

        // clamp x pos
        this.pos.x = clamp(this.pos.x, levelSize.x-2, 2);

        // randomly blink
        rand() < .005 && this.blinkTimer.set(rand(.2,.1));
    }
       
    render()
    {
        if (!isOverlapping(this.pos, this.size, cameraPos, renderWindowSize))
            return;

        // set tile to use
        this.tileIndex = this.isDead() ? this.bodyTile : this.climbingLadder || this.groundTimer.active() ? this.bodyTile + 2*this.walkCyclePercent|0 : this.bodyTile+1;

        let additive = this.additiveColor.add(this.extraAdditiveColor);
        if (this.isPlayer && !this.isDead() && this.dodgeRechargeTimer.elapsed() && this.dodgeRechargeTimer.get() < .2)
        {
            const v = .6 - this.dodgeRechargeTimer.get()*3;
            additive = additive.add(new Color(0,v,v,0)).clamp();
        }
        if (this.sprinting)
        {
            // warm glow so sprinting reads clearly differently from normal movement
            additive = additive.add(new Color(.3,.2,0,0)).clamp();
        }

        const sizeScale = this.sizeScale;
        const color = this.color.scale(this.burnColorPercent(),1);
        const eyeColor = this.eyeColor.scale(this.burnColorPercent(),1);

        const bodyPos = this.pos.add(vec2(0,-.1+.06*Math.sin(this.walkCyclePercent*PI)).scale(sizeScale));
        drawTile(bodyPos, vec2(sizeScale), this.tileIndex, this.tileSize, color, this.angle, this.mirror, additive);
        drawTile(this.pos.add(vec2(this.getMirrorSign(.05),.46).scale(sizeScale).rotate(-this.angle)),vec2(sizeScale/2),this.headTile,vec2(8), color,this.angle,this.mirror, additive);

        //for(let i = this.grenadeCount; i--;)
        //    drawTile(bodyPos, vec2(.5), 5, vec2(8), new Color, this.angle, this.mirror, additive);

        const blinkScale = this.canBlink ? this.isDead() ? .3: .5 + .5*Math.cos(this.blinkTimer.getPercent()*PI*2) : 1;
            drawTile(this.pos.add(vec2(this.getMirrorSign(.05),.46).scale(sizeScale).rotate(-this.angle)),vec2(sizeScale/2, blinkScale*sizeScale/2),this.headTile+1,vec2(8), eyeColor, this.angle, this.mirror, this.additiveColor);
    }

    damage(damage, damagingObject)
    {
        if (this.destroyed)
            return;

        if (this.dodgeTimer.active())
            return; // brief invulnerability window while dashing/dodging

        if (this.team == team_player)
        {
            // safety window after spawn
            if (godMode || this.getAliveTime() < 2)
                return;
        }

        if (this.isDead() && !this.persistent)
        {
            this.overkill += damage;
            if (this.overkill > 5)
            {
                makeBlood(this.pos, 300);
                this.destroy();
            }
        }

        this.blinkTimer.set(rand(.5,.4));
        makeBlood(damagingObject ? damagingObject.pos : this.pos);
        super.damage(damage, damagingObject);
    }

    kill(damagingObject)                  
    {
        if (this.isDead())
            return 0;

        if (levelWarmup)
        {
            this.destroy();
            return 1;
        }
        
        this.deadTimer.set();
        this.size = this.size.scale(.5);

        makeBlood(this.pos, 300);
        playSound(sound_die, this.pos);

        this.team = team_none;
        this.health = 0;
        const fallDirection = damagingObject ? sign(damagingObject.velocity.x) : randSign();
        this.angleVelocity = fallDirection*rand(.22,.14);
        this.angleDamping = .9;
        this.weapon && this.weapon.destroy();

        // move to back layer
        this.renderOrder = 1;
    }
    
    collideWithTile(data, pos)
    {
        if (!data)
            return;

        if (data == tileType_ladder)
        {
            if (pos.y + 1 > this.lastPos.y - this.size.y*.5)
                return;

            if (getTileCollisionData(pos.add(vec2(0,1))) // above
                && !(getTileCollisionData(pos.add(vec2(1,0))) // left
                    && getTileCollisionData(pos.add(vec2(1,0)))) // right
            )
                return; // dont collide if something above it and nothing to left or right

            // allow standing on top of ladders
            return !this.climbingLadder;
        }

        // break blocks above
        const d = pos.y - this.pos.y;
        if (!this.climbingLadder && this.velocity.y > .1 && d > 0 && d < this.size.y*.5)
        {
            if (destroyTile(pos))
            {
                this.velocity.y = 0;
                return;
            }
        }

        return 1;
    }

    collideWithObject(o)
    {
        if (this.isDead())
            return super.collideWithObject(o);

        if (o.velocity.lengthSquared() > .04)
        {
            const v = o.velocity.subtract(this.velocity);
            const  m = 25*o.mass * v.lengthSquared();
            if (!o.groundObject && o.isCrushing && !this.persistent && o.velocity.y < 0 && this.pos.y < o.pos.y - o.size.y/2 && abs(o.pos.x - this.pos.x) < o.size.x*.5)
            {
                // crushing
                this.damage(1e3, o);
                if (this.isDead())
                {
                    makeBlood(this.pos, 300);
                    this.destroy();
                }
            }
            else if (m > 1)
                this.damage(4*m|0, o)
        }

        return super.collideWithObject(o);
    }
}

///////////////////////////////////////////////////////////////////////////////

const type_weak   = 0;
const type_normal = 1;
const type_strong = 2;
const type_elite  = 3;
const type_grenade= 4;
const type_count  = 5;

// explicit awareness state machine - a labeling/movement-routing layer built on top of the
// existing timer-driven building blocks (reactionTimer, sawPlayerTimer, shootTimer, etc), so the
// underlying tuned combat feel stays the same while the control flow becomes readable/inspectable.
// See Enemy.determineAIState() for the transition logic and the explanation at the end of this task.
const aiState_idle   = 'IDLE';
const aiState_patrol = 'PATROL';
const aiState_alert  = 'ALERT';
const aiState_chase  = 'CHASE';
const aiState_attack = 'ATTACK';
const aiState_search = 'SEARCH';
const aiState_return = 'RETURN';

// enemy behavior archetypes - orthogonal to the type_weak..type_grenade power tiers above
// (those still control color/health-tier/vision-range/dodge/grenade-use). This table controls
// movement speed, health, knockback resistance and damage output, and whether the enemy tries
// to keep its distance (preferredRange > 0 = ranged kiting instead of closing to melee range).
// Adding a new archetype later just means adding an entry here.
const behaviorType_basic  = 0;
const behaviorType_fast   = 1;
const behaviorType_tank   = 2;
const behaviorType_ranged = 3;

const ENEMY_BEHAVIOR_TYPES = [
    { name:'Basic',  speedMult:1,   healthMult:1,   knockbackMult:1,   damageMult:1,   preferredRange:0, sizeMult:1    },
    { name:'Fast',   speedMult:1.6, healthMult:.6,  knockbackMult:1.3, damageMult:.8,  preferredRange:0, sizeMult:.85  },
    { name:'Tank',   speedMult:.6,  healthMult:2.5, knockbackMult:.25, damageMult:1.6, preferredRange:0, sizeMult:1.25 },
    { name:'Ranged', speedMult:1,   healthMult:.8,  knockbackMult:1,   damageMult:1,   preferredRange:7, sizeMult:1    },
];

function alertEnemies(pos, playerPos)
{
    const radius = 4;
    forEachObject(pos, radius, (o)=>{o.team == team_enemy && o.alert && o.alert(playerPos)});
    debugAI && debugCircle(pos, radius, '#0ff6');
}

class Enemy extends Character
{
    constructor(pos) 
    { 
        super(pos);

        this.team = team_enemy;
        this.sawPlayerTimer = new Timer;
        this.reactionTimer = new Timer;
        this.facePlayerTimer = new Timer;
        this.holdJumpTimer = new Timer;
        this.shootTimer = new Timer;
        this.idleTimer = new Timer;        // occasionally makes PATROL pause into a real IDLE
        this.searchLookTimer = new Timer;  // makes SEARCH glance around instead of just walking
        this.maxVisionRange = 12;

        // awareness state machine anchor: PATROL wanders near this, RETURN walks back to it
        this.aiState = aiState_patrol;
        this.spawnPos = pos.copy();

        this.type = randSeeded()**3*min(level+1,type_count)|0;

        // behavior archetype (Basic/Fast/Tank/Ranged) - independent roll from the power tier
        // above, drives movement speed, health, knockback resistance, damage and kiting
        this.behaviorType = randSeeded()*ENEMY_BEHAVIOR_TYPES.length|0;
        const behaviorDef = ENEMY_BEHAVIOR_TYPES[this.behaviorType];
        this.speedMult      = behaviorDef.speedMult;
        this.knockbackMult  = behaviorDef.knockbackMult;
        this.damageMult     = behaviorDef.damageMult;
        this.preferredRange = behaviorDef.preferredRange;

        let health = 1 + this.type;
        this.eyeColor = new Color(1,.5,0);
        if (this.type == type_weak)
        {
            this.color = new Color(0,1,0);
            this.size = this.size.scale(this.sizeScale = .9);
        }
        else if (this.type == type_normal)
        {
            this.color = new Color(0,.4,1);
        }
        else if (this.type == type_strong)
        {
            this.color = new Color(1,0,0);
            this.eyeColor = new Color(1,1,0);
        }
        else if (this.type == type_elite)
        {
            this.color = new Color(1,1,1);
            this.eyeColor = new Color(1,0,0);
            this.maxVisionRange = 15;
        }
        else if (this.type == type_grenade)
        {
            this.color = new Color(.7,0,1);
            this.eyeColor = new Color(0,0,0);
            this.grenadeCount = 3;
            this.canBurn = 0;
        }

        if (this.isBig = randSeeded() < .05)
        {
            // chance of large enemy with extra health
            this.size = this.size.scale(this.sizeScale = 1.3);
            health *= 2;
            this.grenadeCount *= 10;
            this.maxVisionRange = 15;
            --levelEnemyCount;
        }

        // apply the behavior archetype's size tell (Fast = leaner, Tank = bulkier) on top of
        // whatever the power tier above already set, and scale health by its multiplier
        this.size = this.size.scale(behaviorDef.sizeMult);
        this.sizeScale *= behaviorDef.sizeMult;
        health *= behaviorDef.healthMult;

        this.health = this.healthMax = health;
        this.color = this.color.mutate();
        this.mirror = rand() < .5;

        new Weapon(this.pos, this);
         --levelEnemyCount;

        this.sightCheckFrame = rand(9)|0;
    }
    
    update()
    {
        if (!aiEnable || levelWarmup || this.isDead() || !this.inUpdateWindow())
        {
            if (this.weapon)
                this.weapon.triggerIsDown = 0;
            super.update();
            return; // ignore offscreen objects
        }

        if (this.weapon)
            this.weapon.localPos = this.weapon.localOffset.scale(this.sizeScale);

        // update check if players are visible
        const sightCheckFrames = 9;
        ASSERT(this.sawPlayerPos || !this.sawPlayerTimer.isSet());
        if (frame%sightCheckFrames == this.sightCheckFrame)
        {
            const sawRecently = this.sawPlayerTimer.isSet() && this.sawPlayerTimer.get() < 5;
            const visionRangeSquared = (sawRecently ? this.maxVisionRange * 1.2 : this.maxVisionRange)**2;
            debugAI && debugCircle(this.pos, visionRangeSquared**.5, '#f003', .1);
            for(const player of players)
            {
                // check range
                if (player && !player.isDead())
                if (sawRecently || this.getMirrorSign() == sign(player.pos.x - this.pos.x))
                if (sawRecently || abs(player.pos.x - this.pos.x) > abs(player.pos.y - this.pos.y) ) // 45 degree slope
                if (this.pos.distanceSquared(player.pos) < visionRangeSquared)
                {
                    const raycastHit = tileCollisionRaycast(this.pos, player.pos);
                    if (!raycastHit)
                    {
                        this.alert(player.pos, 1);
                        debugAI && debugLine(this.pos, player.pos, '#0f0',.1)
                        break;
                    }
                    debugAI && debugLine(this.pos, player.pos, '#f00',.1)
                    debugAI && raycastHit && debugPoint(raycastHit, '#ff0',.1)
                }
            }

            if (sawRecently)
            {
                // alert nearby enemies
                alertEnemies(this.pos, this.sawPlayerPos);
            }
        }

        this.pressedDodge = this.climbingWall = this.pressingThrow = 0;

        // decide which named awareness state we're in this frame (see determineAIState()) -
        // this only labels/routes behavior, the actual probabilities below are unchanged
        // from the original tuning wherever the requested new behaviors don't apply
        this.aiState = this.determineAIState();
        debugAI && debugRect(this.pos, this.size, {
            [aiState_idle]:'#8888', [aiState_patrol]:'#0f08', [aiState_alert]:'#ff08',
            [aiState_chase]:'#fa08', [aiState_attack]:'#f008', [aiState_search]:'#f0f8',
            [aiState_return]:'#00f8'
        }[this.aiState]);

        if (this.burnTimer.isSet())
        {
            // burning overrides normal AI with panicked running, regardless of awareness state
            this.facePlayerTimer.unset();

            // random jump
            if (rand()< .005)
            {
                this.pressedJumpTimer.set(.05);
                this.holdJumpTimer.set(rand(.05));
            }
            
            // random movement
            if (rand()<.05)
                this.moveInput.x = randSign()*rand(.6, .3);
            this.moveInput.y = 0;

            // random dodge
            if (this.type == type_elite)
                this.pressedDodge = 1;
            else if (this.groundObject)
                this.pressedDodge = rand() < .005;
        }
        else switch (this.aiState)
        {
            case aiState_alert:
                // just noticed the player: freeze briefly and turn to face them (surprised)
                this.moveInput.x = 0;
                this.weapon.localAngle *= .8;
                break;

            case aiState_chase:
            case aiState_attack:
            {
                debugAI && debugPoint(this.sawPlayerPos, '#f00');

                // wall climb
                if (this.type >= type_strong && this.moveInput.x && !this.velocity.x && this.velocity.y < 0)
                {
                    this.velocity.y *=.8;
                    this.climbingWall = 1;
                    this.pressedJumpTimer.set(.1);
                    this.holdJumpTimer.set(rand(.2));
                }

                this.weapon.localAngle *= .8;
                const timeSinceSawPlayer = this.sawPlayerTimer.get();

                if (!this.dodgeTimer.active())
                {
                    const playerDirection = sign(this.sawPlayerPos.x - this.pos.x);
                    const distanceToPlayer = abs(this.sawPlayerPos.x - this.pos.x);

                    if (this.type == type_grenade && rand() < .002 && this.getMirrorSign() == playerDirection)
                        this.pressingThrow = 1;

                    // actively fighting player
                    if (rand()<.05)
                        this.facePlayerTimer.set(rand(2,.5));

                    // random jump
                    if (rand()<(this.type < type_strong ? .0005 : .005))
                    {
                        this.pressedJumpTimer.set(.1);
                        this.holdJumpTimer.set(rand(.2));
                    }

                    if (this.preferredRange)
                    {
                        // ranged behavior: keep distance instead of closing in - back off if the
                        // player gets too close, nudge closer if too far, else hold position
                        const tooClose = this.preferredRange * .6;
                        const tooFar   = this.preferredRange * 1.3;
                        if (rand()<.04)
                        {
                            if (distanceToPlayer < tooClose)
                                this.moveInput.x = -playerDirection*rand(.6,.35); // retreat
                            else if (distanceToPlayer > tooFar)
                                this.moveInput.x = playerDirection*rand(.3,.15);  // close in a little
                            else
                                this.moveInput.x = 0; // comfortable range, hold ground
                        }
                    }
                    else
                    {
                        // random movement (basic/fast/tank all close in to melee/close range)
                        if (rand()<(this.isBig?.05:.02))
                            this.moveInput.x = 0;
                        else if (rand()<.01)
                            this.moveInput.x = rand()<.6 ? playerDirection*rand(.5, .2) : -playerDirection*rand(.4, .2);
                    }
                    if (rand()<.03)
                        this.moveInput.y = rand()<.5 ? 0 : randSign()*rand(.4, .2);
                
                    // random shoot
                    if (abs(this.sawPlayerPos.y - this.pos.y) < 4)
                    if (!this.shootTimer.isSet() || this.shootTimer.get() > 1)
                        rand() < (this.type > type_weak ? .02 : .01) && this.shootTimer.set(this.isBig ? rand(2,1) : .05);
                }

                // random dodge
                if (this.type == type_elite)
                    this.pressedDodge = rand() < .01 && timeSinceSawPlayer < .5;

                break;
            }

            case aiState_search:
                // was fighting but lost the player: head to their last known position and look around
                debugAI && debugPoint(this.sawPlayerPos, '#f00');

                if (rand()<.04)
                    this.facePlayerTimer.set(rand(2,.5));

                // random movement
                if (rand()<.02)
                    this.moveInput.x = 0;
                else if (rand()<.01)
                    this.moveInput.x = randSign()*rand(.4, .2);

                // random jump
                if (rand() < (this.sawPlayerPos.y > this.pos.y ? .002 : .001))
                {
                    this.pressedJumpTimer.set(.1);
                    this.holdJumpTimer.set(rand(.2));
                }
                
                // random shoot
                if (!this.shootTimer.isSet() || this.shootTimer.get() > 5)
                    rand() < .001 && this.shootTimer.set(rand(.2,.1));

                // move up/down in dirction last player was seen
                this.moveInput.y = clamp(this.sawPlayerPos.y - this.pos.y,.5,-.5);

                // occasionally glance a different direction while searching, instead of
                // always staring straight at the last known player position
                if (this.searchLookTimer.elapsed())
                {
                    this.mirror = rand()<.5;
                    this.searchLookTimer.set(rand(1.5,.5));
                }
                break;

            case aiState_return:
                // gave up the search: walk back to where this enemy originally spawned/patrolled
                if (rand()<.02)
                    this.moveInput.x = 0;
                else if (rand()<.1)
                    this.moveInput.x = sign(this.spawnPos.x - this.pos.x)*rand(.4,.2);
                this.weapon.localAngle = lerp(.1, .7, this.weapon.localAngle);
                break;

            case aiState_idle:
                // brief full stop during patrol, distinct from the loose wandering below
                this.moveInput.x = this.moveInput.y = 0;
                this.weapon.localAngle = lerp(.1, .7, this.weapon.localAngle);
                break;

            case aiState_patrol:
            default:
                // try to act normal, wandering loosely near the patrol/spawn anchor
                if (rand()<.002)
                    this.idleTimer.set(rand(2,1));

                if (rand()<.03)
                    this.moveInput.x = 0;
                else if (rand()<.005)
                    this.moveInput.x = randSign()*rand(.2, .1);
                else if (rand()<.001)
                    this.moveInput.x = randSign()*1e-9; // hack: look in a direction

                this.weapon.localAngle = lerp(.1, .7, this.weapon.localAngle);
                this.reactionTimer.unset();
                break;
        }

        if (this.isBig && this.type != type_elite)
        {
            // big enemies cant jump
            this.pressedJumpTimer.unset();
            this.holdJumpTimer.unset();
        }
        this.holdingShoot = this.shootTimer.active();
        this.holdingJump = this.holdJumpTimer.active();

        super.update();

        // override default mirror
        if (this.facePlayerTimer.active() && !this.dodgeTimer.active() && !this.reactionTimer.active())
            this.mirror = this.sawPlayerPos.x < this.pos.x;
    }

    // decides the current named awareness state from the existing timers/position - this is
    // the actual state machine: PATROL/IDLE (unaware, near spawn) -> ALERT (just spotted the
    // player) -> CHASE (closing distance / repositioning) or ATTACK (in range, fighting) ->
    // SEARCH (lost sight, checks the last known position) -> RETURN (walk back home) -> PATROL
    determineAIState()
    {
        if (this.reactionTimer.active())
            return aiState_alert;

        if (this.sawPlayerTimer.isSet())
        {
            const timeSinceSawPlayer = this.sawPlayerTimer.get();
            if (timeSinceSawPlayer < 5)
            {
                const distanceToPlayer = abs(this.sawPlayerPos.x - this.pos.x);
                const attackRange = this.preferredRange || 6;
                return distanceToPlayer < attackRange ? aiState_attack : aiState_chase;
            }
            if (timeSinceSawPlayer < 10)
                return aiState_search;
        }

        // not currently tracking a player: patrol near the spawn anchor, or walk back to
        // it first if the chase/search above ended up somewhere far away
        if (this.pos.distanceSquared(this.spawnPos) > 8**2)
            return aiState_return;

        return this.idleTimer.active() ? aiState_idle : aiState_patrol;
    }

    alert(playerPos, resetSawPlayer)
    {
        if (resetSawPlayer || !this.sawPlayerTimer.isSet())
        {
            if (!this.reactionTimer.isSet())
            {
                this.reactionTimer.set(rand(1,.5)*(this.type == type_weak ? 2 : 1));
                this.facePlayerTimer.set(rand(2,1));
                if (this.groundObject && rand() < .2)
                    this.velocity.y += .1; // random jump
            }

            this.sawPlayerTimer.set();
            this.sawPlayerPos = playerPos;
        }
    }

    damage(damage, damagingObject)
    {
        const healthBefore = this.health;
        super.damage(damage, damagingObject);
        if (!this.isDead())
        {
            this.alert(damagingObject ? damagingObject.pos.subtract(damagingObject.velocity.normalize()) : this.pos, 1);
            this.reactionTimer.set(rand(1,.5));
            this.shootTimer.unset();

            // combat feedback: hit flash is already handled generically via GameObject's
            // damageTimer/additiveColor, and makeBlood() already fires inside Character.damage()
            // (both reused as-is) - this just adds a dedicated hit sound hook and a damage number.
            // Knockback is reused too: Bullet.collideWithObject()/explosion() already call
            // applyForce() on this object, scaled down by this.knockbackMult for Tank enemies.
            if (this.health < healthBefore)
            {
                playSound(sound_enemyHit, this.pos);
                spawnDamageNumber(this.pos, healthBefore - this.health);
            }
        }
    }

    kill(damagingObject)
    {
        if (this.isDead())
            return 0;

        super.kill(damagingObject);
        if (!levelWarmup)
        {
            ++totalKills;

            // death feedback: makeBlood()/sound_die/ragdoll physics already happen inside
            // Character.kill() (reused as-is) - this adds the score + combo event on top,
            // reusing the existing particle system for the extra punch via makeDamageBurst()
            addKillScore(this, damagingObject);
            makeDamageBurst(this.pos, 30);
        }
    }
}

///////////////////////////////////////////////////////////////////////////////
// boss enemy - extends Enemy so it gets physics/health/damage/weapon/knockback for free, but
// completely replaces the aiState-driven wandering AI with its own explicit state machine:
// IDLE -> INTRO -> ATTACK -> DAMAGE -> ENRAGED -> DEATH. Movement/collision physics itself is
// still the exact same Character.update() every other character uses (called directly via
// Character.prototype.update.call(this), bypassing only Enemy's own AI decision layer).

const bossState_idle    = 'IDLE';
const bossState_intro   = 'INTRO';
const bossState_attack  = 'ATTACK';
const bossState_damage  = 'DAMAGE';
const bossState_enraged = 'ENRAGED';
const bossState_death   = 'DEATH';

class Boss extends Enemy
{
    constructor(pos)
    {
        super(pos);

        // boss overrides: always top power tier, always large, distinct look, tanky, and
        // deterministic (not affected by whatever random tier/isBig roll Enemy's own
        // constructor happened to make before this code runs)
        this.type = type_elite;
        this.isBig = this.isObjectiveBoss = 1;
        this.canBurn = 1;
        this.grenadeCount = 0;
        this.color = new Color(.6,0,.8);
        this.eyeColor = new Color(1,0,0);
        this.sizeScale = 2.2;
        this.size = vec2(.6,.95).scale(this.sizeScale);
        this.maxVisionRange = 30;
        this.knockbackMult = .15; // barely flinches from knockback/explosions

        this.healthMax = this.health = 100 + level*25;
        this.bossPhase = 1;
        this.bossState = bossState_idle;
        this.preDamageState = bossState_attack;
        this.stateTimer = new Timer(.5);  // brief pause before the intro plays
        this.meleeTimer = new Timer;
        this.rangedTimer = new Timer;
        this.chargeTimer = new Timer(3);

        // heavy weapon gives the boss real ranged punch (splash damage, camera shake on fire)
        // for free, reusing the exact multi-weapon system players use to switch weapons
        this.weapon && this.weapon.switchWeapon(weaponType_heavy);

        spawnBossIntroEffect(this.pos);
        playSound(sound_bossIntro, this.pos);
    }

    // layers boss-specific reactions on top of Enemy.damage() (which already gives the hit
    // sound + floating damage number + generic white flash, all reused unchanged)
    damage(damage, damagingObject)
    {
        const healthBefore = this.health;
        super.damage(damage, damagingObject);
        if (this.isDead())
            return;

        if (this.health < healthBefore && this.bossState != bossState_intro && this.bossState != bossState_idle)
        {
            if (this.bossState != bossState_damage)
                this.preDamageState = this.bossState;
            this.bossState = bossState_damage;
            this.stateTimer.set(.25);
            this.updateBossPhase();
        }
    }

    // health-threshold phase check: 100-70% normal, 70-40% faster, 40-0% moves the state
    // machine into ENRAGED outright (a new attack, faster movement, visual tell)
    updateBossPhase()
    {
        const healthPercent = this.health / this.healthMax;
        const newPhase = healthPercent > .7 ? 1 : healthPercent > .4 ? 2 : 3;
        if (newPhase == this.bossPhase)
            return;

        this.bossPhase = newPhase;
        spawnBossPhaseTransitionEffect(this.pos, newPhase);
        playSound(sound_bossPhase, this.pos);

        if (newPhase == 3)
        {
            this.preDamageState = bossState_enraged; // damage-stagger now returns to ENRAGED
            this.additiveColor = new Color(1,.1,0,.35); // enraged visual tell
        }
    }

    kill(damagingObject)
    {
        if (this.isDead())
            return 0;

        this.bossState = bossState_death;

        // mark fully dead FIRST (Enemy.kill()->Character.kill() zeroes health/team) so that
        // the death explosion below - which damages everything nearby including potentially
        // this same object - can't re-trigger kill() on the boss a second time; GameObject's
        // shared damage() entry point already no-ops once isDead() is true
        super.kill(damagingObject); // Enemy.kill() -> score(bossKill)/combo/blood/ragdoll, unchanged

        spawnBossDeathEffect(this.pos);
        playSound(sound_bossDeath, this.pos);
    }

    update()
    {
        // keep the weapon visually scaled to this boss's (much larger) size - Enemy.update()
        // normally does this itself, but Boss never calls it
        if (this.weapon)
            this.weapon.localPos = this.weapon.localOffset.scale(this.sizeScale);

        if (this.isDead())
        {
            Character.prototype.update.call(this);
            return;
        }

        // boss AI always knows where the nearest player is - a direct, readable fight rather
        // than the vision-cone/raycast sneaking Enemy.update() normally does for regular enemies
        let target, targetDistSq = 1e9;
        for (const player of players)
        {
            const d = player && !player.isDead() ? player.pos.distanceSquared(this.pos) : 1e9;
            if (d < targetDistSq)
                target = player, targetDistSq = d;
        }

        this.pressedDodge = this.pressingThrow = this.holdingShoot = 0;
        this.moveInput.x = this.moveInput.y = 0;

        switch (this.bossState)
        {
            case bossState_idle:
                if (this.stateTimer.elapsed())
                {
                    this.bossState = bossState_intro;
                    this.stateTimer.set(1.5);
                }
                break;

            case bossState_intro:
                // announcement window - stands still, doesn't attack yet
                if (this.stateTimer.elapsed())
                    this.bossState = bossState_attack;
                break;

            case bossState_damage:
                // brief stagger, then back to whichever combat state it was in before
                if (this.stateTimer.elapsed())
                    this.bossState = this.preDamageState;
                break;

            case bossState_attack:
            case bossState_enraged:
                this.runCombatAI(target, this.bossState == bossState_enraged);
                break;
        }

        Character.prototype.update.call(this);
    }

    // shared attack-loop logic for both ATTACK and ENRAGED - movement, melee, ranged, and the
    // enraged-only charge dash. Reuses the existing Weapon system for the ranged half (setting
    // holdingShoot lets Character.update()'s existing weapon-trigger wiring do the rest).
    runCombatAI(target, enraged)
    {
        if (!target)
            return;

        this.speedMult = enraged ? 1.6 : this.bossPhase == 2 ? 1.2 : 1;

        const dir = sign(target.pos.x - this.pos.x);
        const dist = abs(target.pos.x - this.pos.x);
        this.mirror = dir < 0;

        // movement: close the distance, but not so close it can't still use ranged attacks
        if (dist > 3)
            this.moveInput.x = dir * (enraged ? .6 : .35);

        // melee swipe up close
        if (dist < 1.6 && this.meleeTimer.elapsed())
        {
            this.meleeAttack(target);
            this.meleeTimer.set(enraged ? .7 : 1.4);
        }

        // ranged attack (heavy weapon) at medium/long range
        if (dist > 1.6 && this.rangedTimer.elapsed())
        {
            this.holdingShoot = 1;
            this.rangedTimer.set(enraged ? .5 : this.bossPhase == 2 ? .9 : 1.4);
        }

        // enraged-only: periodic charge dash - a new attack that only exists in this phase
        if (enraged && dist > 4 && dist < 14 && this.chargeTimer.elapsed())
        {
            this.velocity.x += dir * .35;
            spawnBossChargeEffect(this.pos, dir);
            playSound(sound_bossCharge, this.pos);
            this.chargeTimer.set(4);
        }
    }

    meleeAttack(target)
    {
        if (target.pos.distanceSquared(this.pos) < 4)
        {
            target.damage(this.bossPhase == 3 ? 3 : 2, this);
            target.applyForce(target.pos.subtract(this.pos).normalize(.35));
        }
        spawnBossMeleeEffect(this.pos, this.mirror);
        playSound(sound_bossMelee, this.pos);
    }
}

///////////////////////////////////////////////////////////////////////////////

// applies a picked-up power-up to a player - instant effects (Health) happen immediately and
// need no further bookkeeping; everything else just (re)starts/refreshes its duration timer.
// Called from PowerUp.update() in appObjects.js.
function applyPowerUp(player, type)
{
    ++levelPowerUpsCollected; // feeds the "collect" objective type in appLevel.js

    const def = POWERUP_TYPES[type];
    if (def.instant)
    {
        if (type == powerUp_health)
            player.heal(def.healAmount);
        return;
    }

    if (!player.powerUpTimers[type])
        player.powerUpTimers[type] = new Timer;
    player.powerUpTimers[type].set(def.duration);

    if (type == powerUp_shield)
        player.shieldHealth = def.shieldAmount; // (re)fill the absorb buffer on pickup too
}

// called once, right when a timed power-up's duration runs out (see Player.updatePowerUps())
function onPowerUpExpired(player, type)
{
    if (type == powerUp_shield)
        player.shieldHealth = 0;

    spawnPowerUpExpireEffect(player.pos, POWERUP_TYPES[type].color);
    playSound(sound_powerupExpire, player.pos);
}

class Player extends Character
{
    constructor(pos, playerIndex=0) 
    { 
        super(pos);

        this.grenadeCount = 3;
        this.burnTime = 2;
        
        this.eyeColor = (new Color).setHSLA(-playerIndex*.6,1,.5);
        if (playerIndex)
        {
            this.color = (new Color).setHSLA(playerIndex*.3-.3,.5,.5);
            this.extraAdditiveColor = (new Color).setHSLA(playerIndex*.3-.3,1,.1,0);
        }

        this.bodyTile = 5;
        this.headTile = 18;
        this.playerIndex = playerIndex;
        this.renderOrder = 20 + 10*playerIndex;
        this.walkSoundTime = 0;

        // sprint / stamina
        this.stamina = staminaMax;
        this.staminaRegenTimer = new Timer;
        this.sprintDustTimer = new Timer;

        // damage / death feedback
        this.displayHealth = this.health;   // eased value used for the animated HUD health bar
        this.hitFlashTimer = new Timer;
        this.lastDamageSourcePos = 0;
        this.isDeathFlash = 0;

        // power-ups: powerUpTimers[type] existing+active() means that timed buff is currently
        // applied; derived stats (speedMult/damageMult/fireRateMult/armor) are recomputed fresh
        // every frame in updatePowerUps() rather than mutated on pickup, so re-picking up a
        // power-up mid-duration just cleanly refreshes it instead of risking stacked/stale state
        this.powerUpTimers = {};
        this.shieldHealth = 0;

        this.persistent = this.wasHoldingJump = this.canBlink = this.isPlayer = 1;
        this.team = team_player;
        
        new Weapon(this.pos, this);
        players[playerIndex] = this;
        
        // small jump on spawn
        this.velocity.y = .2;
        this.mirror = playerIndex%2;
        --playerLives;
    }

    damage(damage, damagingObject)
    {
        // Armor power-up: flat percentage damage reduction, applied first
        if (this.isPowerUpActive(powerUp_armor))
            damage *= 1 - POWERUP_TYPES[powerUp_armor].value;

        // Shield power-up: absorbs from its own buffer before any real health is lost
        if (this.shieldHealth > 0)
        {
            const absorbed = min(this.shieldHealth, damage);
            this.shieldHealth -= absorbed;
            damage -= absorbed;
            spawnShieldHitEffect(this.pos);
            if (!damage)
                return 0; // fully absorbed - no health lost, skip the rest of the damage flow
        }

        // let Character.damage() run its normal logic (safety window, dash invuln, blood, etc)
        // then layer stronger player-only feedback on top, only if damage actually landed
        const healthBefore = this.health;
        super.damage(damage, damagingObject);
        if (!this.isDead() && this.health < healthBefore)
            playerDamageFeedback(this, healthBefore - this.health, damagingObject);
    }

    kill(damagingObject)
    {
        const wasAlive = !this.isDead();
        super.kill(damagingObject);
        if (wasAlive && this.isDead())
            playerDeathFeedback(this);
    }

    isPowerUpActive(type)
    {
        return this.powerUpTimers[type] && this.powerUpTimers[type].active();
    }

    updatePowerUps()
    {
        // recompute derived stats fresh every frame from which timed power-ups are still
        // active, rather than mutating them once on pickup and un-mutating on expiry - this
        // means re-collecting the same power-up mid-duration can never leave stale/stacked
        // state behind. speedMult/damageMult are the exact same fields the sprint system and
        // the enemy Tank/Fast archetypes already use, so no other code needs to know about
        // power-ups at all - Character.update()'s movement clamp and Weapon.update()'s damage
        // calculation already read them.
        this.speedMult    = this.isPowerUpActive(powerUp_speedBoost)  ? POWERUP_TYPES[powerUp_speedBoost].value  : 1;
        this.damageMult   = this.isPowerUpActive(powerUp_damageBoost) ? POWERUP_TYPES[powerUp_damageBoost].value : 1;
        this.fireRateMult = this.isPowerUpActive(powerUp_rapidFire)   ? POWERUP_TYPES[powerUp_rapidFire].value   : 1;

        // fire the "expiration effect" exactly once, on the frame a buff actually runs out
        for(const type in this.powerUpTimers)
        {
            const timer = this.powerUpTimers[type];
            const isActive = timer.active();
            if (timer.wasActive && !isActive)
                onPowerUpExpired(this, type);
            timer.wasActive = isActive;
        }
    }

    update()
    {
        this.updatePowerUps();

        if (this.isDead())
        {
            if (this.persistent && playerLives)
            {
                if (players.length == 1)
                {
                    if (this.deadTimer.get() > 2)
                    {
                        this.persistent = 0;
                        new Player(checkpointPos, this.playerIndex);
                        playSound(sound_jump, cameraPos);
                    }
                }
                else
                {
                    // respawn only if all players dead, or checkpoint touched
                    let hasLivingPlayers = 0;
                    let minDeadTime = 1e3;
                    for(const player of players)
                    {
                        if (player)
                        {
                            minDeadTime = min(minDeadTime, player.isDead() ? player.deadTimer.get() : 1e3);
                            hasLivingPlayers |= (!player.isDead() && player.getAliveTime() > .1);
                        }
                    }

                    if (minDeadTime > 2)
                    {
                        if (!hasLivingPlayers)
                        {
                            // respawn all
                            this.persistent = 0;
                            new Player(checkpointPos.add(vec2(1-this.playerIndex/2,0)), this.playerIndex);
                            this.playerIndex || playSound(sound_jump, cameraPos);
                        }
                        else if (checkpointTimer.active())
                        {
                            // respawn if checkpoint active
                            this.persistent = 0;
                            const player = new Player(checkpointPos, this.playerIndex);
                            playSound(sound_jump, cameraPos);
                        }
                    }
                }
            }

            super.update();
            return;
        }

        // wall climb
        this.climbingWall = 0;
        if (this.moveInput.x && !this.velocity.x && this.velocity.y < 0)
        {
            this.velocity.y *=.8;
            this.climbingWall = 1;
        }

        // movement control
        this.moveInput.x = isUsingGamepad || this.playerIndex ? gamepadStick(0, this.playerIndex).x : keyIsDown(39) - keyIsDown(37);

        this.moveInput.y = isUsingGamepad || this.playerIndex ? gamepadStick(0, this.playerIndex).y : keyIsDown(38) - keyIsDown(40);
        
        // jump
        this.holdingJump = (!this.playerIndex && keyIsDown(38)) || gamepadIsDown(0, this.playerIndex);
        if (!this.holdingJump)
            this.pressedJumpTimer.unset();
        else if (!this.wasHoldingJump || this.climbingWall)
            this.pressedJumpTimer.set(.3);
        this.wasHoldingJump = this.holdingJump;

        // controls
        this.holdingShoot  = !this.playerIndex && (mouseIsDown(0) || keyIsDown(90)) || gamepadIsDown(2, this.playerIndex);
        this.pressingThrow = !this.playerIndex && (mouseIsDown(2) || keyIsDown(67)) || gamepadIsDown(1, this.playerIndex);
        this.pressedDodge  = !this.playerIndex && (mouseIsDown(1) || keyIsDown(88)) || gamepadIsDown(3, this.playerIndex);

        // sprint (Shift for player 0, right bumper for other gamepads)
        this.pressingSprint = !this.playerIndex && keyIsDown(16) || gamepadIsDown(5, this.playerIndex);
        const wantsToSprint = this.pressingSprint && abs(this.moveInput.x) > .1
            && !this.dodgeTimer.active() && !this.climbingLadder;
        this.sprinting = wantsToSprint && this.stamina > 0;

        if (this.sprinting)
        {
            this.stamina = max(this.stamina - timeDelta * staminaDrainRate, 0);
            this.staminaRegenTimer.set(staminaRegenDelay);

            // kick up a dust trail while sprinting on the ground
            if (this.groundTimer.active() && this.sprintDustTimer.elapsed())
            {
                makeSprintDust(this.pos.subtract(vec2(0, this.size.y*.4)), this.mirror);
                this.sprintDustTimer.set(.08);
            }
        }
        else if (this.staminaRegenTimer.elapsed())
            this.stamina = min(this.stamina + timeDelta * staminaRegenRate, staminaMax);

        super.update();

        // update walk sound
        this.walkSoundTime += abs(this.velocity.x);
        if (abs(this.velocity.x) > .01 && this.groundTimer.active() && !this.dodgeTimer.active())
        {
            if (this.walkSoundTime > 1)
            {
                this.walkSoundTime = 0;
                playSound(sound_walk, this.pos);
            }
        }
        else
            this.walkSoundTime = .5;

        if (players.length > 1 && !this.isDead())
        {
            // move to other player if offscreen and multiplayer
            if (!isOverlapping(this.pos, this.size, cameraPos, gameplayWindowSize))
            {
                // move to location of another player if not falling off a cliff
                if (tileCollisionRaycast(this.pos,vec2(this.pos.x,0)))
                {
                    for(const player of players)
                        if (player && player != this && !player.isDead())
                        {
                            this.pos = player.pos.copy();
                            this.velocity = vec2();
                            playSound(sound_jump, this.pos);
                        }
                }
                else
                    this.kill();
            }
        }
    }
}