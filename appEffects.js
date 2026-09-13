/*
    Javascript Space Game
    By aashuu  

*/

'use strict';

const precipitationEnable = 1;
const debugFire = 0;

///////////////////////////////////////////////////////////////////////////////
// sounds

const sound_shoot =        [,,90,,.01,.03,4,,,,,,,9,50,.2,,.2,.01];
const sound_destroyTile =  [.5,,1e3,.02,,.2,1,3,.1,,,,,1,-30,.5,,.5];
const sound_die =          [.5,.4,126,.05,,.2,1,2.09,,-4,,,1,1,1,.4,.03];
const sound_jump =         [.4,.2,250,.04,,.04,,,1,,,,,3];
const sound_dodge =        [.4,.2,150,.05,,.05,,,-1,,,,,4,,,,,.02];
const sound_walk =         [.3,.1,70,,,.01,4,,,,-9,.1,,,,,,.5];
const sound_explosion =    [2,.2,72,.01,.01,.2,4,,,,,,,1,,.5,.1,.5,.02];
const sound_checkpoint =   [.6,0,500,,.04,.3,1,2,,,570,.02,.02,,,,.04];
const sound_rain =         [.02,,1e3,2,,2,,,,,,,,99];
const sound_wind =         [.01,.3,2e3,2,1,2,,,,,,,1,2,,,,,,.1];
const sound_grenade =      [.5,.01,300,,,.02,3,.22,,,-9,.2,,,,,,.5];
const sound_hurt =         [.5,.2,180,.02,,.15,1,1.5,,-4,,,,,,,.02];
const sound_switchWeapon = [.3,.1,220,.02,.02,.05,,,,,,,,,,,,.3];
const sound_reload =       [.4,.2,120,.05,.1,.1,1,1.2,,,,,,,,,.05,.4];
const sound_emptyClick =   [.2,,900,,,.02,,,,,,,,,,,,.4];
const sound_enemyHit =     [.3,.2,220,.01,,.08,2,1.2,,,,,,,,,,,.01];
const sound_powerup =      [.6,.2,440,.05,.1,.15,,2,,,220,.1,,,,,,.5,.05];
const sound_powerupExpire =[.3,.2,300,.1,,.2,,1.5,,-6,,,,,,,,.3];
const sound_objectiveStart =   [.4,.1,300,,.05,.1,,1.5,,,180,.08,,,,,,.4];
const sound_objectiveComplete= [.5,.2,400,,.1,.2,,2,,,300,.15,,,,,,.5,.05];
const sound_objectiveFail =    [.4,.2,150,,,.2,,1.5,,-3,,,,,,,,.4];
const sound_bossIntro =   [.8,.3,80,.1,.2,.4,3,2,,,,,,,,,,.6,.1];
const sound_bossPhase =   [.7,.2,200,,.05,.3,2,1.8,,,,,,,,,,.5];
const sound_bossMelee =   [.6,.2,120,.02,,.15,3,1.5,,,,,,,,,,.4];
const sound_bossCharge =  [.5,.1,300,.02,,.1,,1.2,-3,,,,,,,,,.3];
const sound_bossDeath =   [1,.3,60,.3,.2,.6,3,2,,,,,,,,,,.7,.1];
const sound_levelEvent =  [.5,.1,500,,.1,.15,,1.8,,,300,.1,,,,,,.4];

///////////////////////////////////////////////////////////////////////////////
// special effects

const persistentParticleDestroyCallback = (particle)=>
{
    // copy particle to tile layer on death
    ASSERT(particle.tileIndex < 0); // quick draw to tile layer uses canvas 2d so must be untextured
    if (particle.groundObject)
        tileLayer.drawTile(particle.pos, particle.size, particle.tileIndex, particle.tileSize, particle.color, particle.angle, particle.mirror);
}

function makeBlood(pos, amount=50)
{
    const emitter = new ParticleEmitter(
        pos, 1, .1, amount, PI, // pos, emitSize, emitTime, emitRate, emiteCone
        undefined, undefined,   // tileIndex, tileSize
        new Color(1,0,0), new Color(.5,0,0), // colorStartA, colorStartB
        new Color(1,0,0), new Color(.5,0,0), // colorEndA, colorEndB
        3, .1, .1, .1, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        1, .95, .7, PI, 0,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
        .5, 1              // randomness, collide, additive, randomColorLinear, renderOrder
    );
    emitter.particleDestroyCallback = persistentParticleDestroyCallback;
    return emitter;
}

function makeFire(pos = vec2())
{
    return new ParticleEmitter(
        pos, 1, 0, 60, PI, // pos, emitSize, emitTime, emitRate, emiteCone
        0, undefined,   // tileIndex, tileSize
        new Color(1,1,0), new Color(1,.5,.5), // colorStartA, colorStartB
        new Color(1,0,0), new Color(1,.5,.1), // colorEndA, colorEndB
        .5, .5, .1, .01, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .95, .1, -.05, PI, .5,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
        .5, 0, 1);             // randomness, collide, additive, randomColorLinear, renderOrder
}

function makeDebris(pos, color = new Color, amount = 100)
{
    const color2 = color.lerp(new Color, .5);
    const emitter = new ParticleEmitter(
        pos, 1, .1, amount, PI, // pos, emitSize, emitTime, emitRate, emiteCone
        undefined, undefined, // tileIndex, tileSize
        color, color2,       // colorStartA, colorStartB
        color, color2,       // colorEndA, colorEndB
        3, .2, .2, .1, .05, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        1, .95, .4, PI, 0,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
        .5, 1               // randomness, collide, additive, randomColorLinear, renderOrder
    );
    emitter.elasticity = .3;
    emitter.particleDestroyCallback = persistentParticleDestroyCallback;
    return emitter;
}

function makeWater(pos, amount=400)
{
    // overall spray
    new ParticleEmitter(
        pos, 1, .05, 400, PI, // pos, emitSize, emitTime, emitRate, emiteCone
        0, undefined,        // tileIndex, tileSize
        new Color(1,1,1,.5), new Color(.5,1,1,.2), // colorStartA, colorStartB
        new Color(1,1,1,.5), new Color(.5,1,1,.2), // colorEndA, colorEndB
        .5, .5, 2, .1, .05, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .9, 1, 0, PI, .5,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
        .5, 0, 0, 0, 1e9              // randomness, collide, additive, randomColorLinear, renderOrder
    );

    // droplets
    const emitter = new ParticleEmitter(
        pos, 1, .1, amount, PI, // pos, emitSize, emitTime, emitRate, emiteCone
        0, undefined,   // tileIndex, tileSize
        new Color(.8,1,1,.6), new Color(.5,.5,1,.2), // colorStartA, colorStartB
        new Color(.8,1,1,.6), new Color(.5,.5,1,.2), // colorEndA, colorEndB
        2, .1, .1, .2, 0,  // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .99, 1, .5, PI, .2,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
        .5, 1              // randomness, collide, additive, randomColorLinear, renderOrder
    );
    emitter.elasticity = .2;
    emitter.trailScale = 2;

    // put out fires
    const radius = 3;
    forEachObject(pos, 3, (o)=> 
    {
        if (o.isGameObject)
        {
            o.burnTimer.isSet() && o.extinguish();
            const d = o.pos.distance(pos);
            const p = percent(d, radius/2, radius);
            const force = o.pos.subtract(pos).normalize(p*radius*.2);
            o.applyForce(force);
            if (o.isDead && o.isDead())
                o.angleVelocity += randSign()*rand(radius/4,.3);
        }
    });

    debugFire && debugCircle(pos, radius, '#0ff', 1)

    return emitter;
}

///////////////////////////////////////////////////////////////////////////////
// player feedback effects: sprint dust, dash trail, camera shake, damage/death feedback

let cameraShakeTimer = new Timer, cameraShakeMagnitude = 0;
function shakeCamera(magnitude=.3, duration=.2)
{
    // don't let a small shake cut a bigger one short
    if (!cameraShakeTimer.active() || magnitude > cameraShakeMagnitude)
    {
        cameraShakeMagnitude = magnitude;
        cameraShakeTimer.set(duration);
    }
}

function makeSprintDust(pos, mirror)
{
    // small dust kicked up behind the player's feet while sprinting
    const emitter = new ParticleEmitter(
        pos, .3, 0, 1, .5, // pos, emitSize, emitTime, emitRate, emitConeAngle
        undefined, undefined, // tileIndex, tileSize
        new Color(.8,.7,.5,.4), new Color(.6,.5,.4,.3), // colorStartA, colorStartB
        new Color(.8,.7,.5,0),  new Color(.6,.5,.4,0),  // colorEndA, colorEndB
        .3, .15, .3, .05, .05, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .9, .9, 0, PI/4, .3,   // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .4, 0                  // randomness, collideTiles
    );
    emitter.angle = mirror ? 0 : PI; // kick dust backwards, away from movement direction
    emitter.elasticity = .2;
    return emitter;
}

function makeDashEffect(pos, angle)
{
    // quick burst of speed-line particles trailing behind the dash
    const emitter = new ParticleEmitter(
        pos, .2, .12, 150, .2, // pos, emitSize, emitTime, emitRate, emitConeAngle
        undefined, undefined,  // tileIndex, tileSize
        new Color(.6,.9,1,.8), new Color(.9,.9,1,.6), // colorStartA, colorStartB
        new Color(.6,.9,1,0),  new Color(.9,.9,1,0),  // colorEndA, colorEndB
        .25, .05, .05, .5, 0, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .85, 1, 0, .1, .1,    // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .3, 0, 1              // randomness, collideTiles, additive
    );
    emitter.angle = angle + PI; // particles trail behind the dash direction
    emitter.trailScale = 3;
    return emitter;
}

function makeDamageBurst(pos, amount=40)
{
    // sharp red/orange impact burst, stronger and quicker than the default blood splatter
    const emitter = new ParticleEmitter(
        pos, .3, .08, amount, PI, // pos, emitSize, emitTime, emitRate, emitConeAngle
        undefined, undefined,     // tileIndex, tileSize
        new Color(1,.2,.1), new Color(1,.6,.2),  // colorStartA, colorStartB
        new Color(1,0,0,0), new Color(1,.3,0,0), // colorEndA, colorEndB
        .4, .15, .05, .2, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .9, .95, .3, PI, 0,   // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .5, 1, 1              // randomness, collideTiles, additive
    );
    emitter.elasticity = .3;
    return emitter;
}

function playerDamageFeedback(player, damageAmount, damagingObject)
{
    // strong, hard to miss feedback so the player always notices getting hit
    player.hitFlashTimer.set(.25);
    player.isDeathFlash = 0;
    player.lastDamageSourcePos = (damagingObject ? damagingObject.pos : player.pos).copy();

    shakeCamera(clamp(damageAmount/20, .5, .1), .25);
    makeDamageBurst(player.pos, clamp(damageAmount*4, 60, 15)|0);
    playSound(sound_hurt, player.pos);
}

function playerDeathFeedback(player)
{
    // bigger, longer feedback specifically for dying
    player.hitFlashTimer.set(.6);
    player.isDeathFlash = 1;
    shakeCamera(.8, .5);
    makeDamageBurst(player.pos, 120);
}

///////////////////////////////////////////////////////////////////////////////
// weapon effects: muzzle flash + generic impact spark (reused by splash-capable weapons)

function makeMuzzleFlash(pos, angle, color=new Color(1,.9,.6), amount=20)
{
    const emitter = new ParticleEmitter(
        pos, .1, .04, amount, .3, // pos, emitSize, emitTime, emitRate, emitConeAngle
        undefined, undefined,     // tileIndex, tileSize
        color, color.scale(.8),             // colorStartA, colorStartB
        color.scale(1,0), color.scale(.6,0), // colorEndA, colorEndB
        .08, .3, .05, .4, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .8, .9, 0, .2, .2,    // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .3, 0, 1              // randomness, collideTiles, additive
    );
    emitter.angle = angle;
    return emitter;
}

function makeWeaponImpact(pos, amount=15, color=new Color(1,.7,.3))
{
    // generic weapon impact/splash spark, reused by splash-capable weapons (e.g. the heavy weapon)
    const emitter = new ParticleEmitter(
        pos, .1, .08, amount, PI, // pos, emitSize, emitTime, emitRate, emitConeAngle
        undefined, undefined,     // tileIndex, tileSize
        color, color.scale(.7),             // colorStartA, colorStartB
        color.scale(1,0), color.scale(.5,0), // colorEndA, colorEndB
        .25, .08, .02, .3, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .9, .95, .1, PI, .1,   // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .4, 1, 1                // randomness, collideTiles, additive
    );
    emitter.elasticity = .3;
    return emitter;
}

///////////////////////////////////////////////////////////////////////////////
// destructible material system - each Prop (see appObjects.js) is tagged with one of these,
// which drives damage resistance and what hit-feedback particle it spawns. All feedback here
// reuses makeDebris()/ParticleEmitter, no parallel particle system is introduced.
// - wood: burns easily, splinters into a handful of wood-colored debris when hit
// - metal: takes half damage, throws sparks instead of debris, doesn't burn
// - glass: fragile (takes 1.5x damage), pale/sharp debris - used by the destructible TILE
//   system directly (see destroyTile() below), not by any Prop
// - explosive: normal resistance, sparks on hit (metal-skinned barrels/crates); the actual
//   explosion is still driven by Prop.explosionSize + Prop.kill(), unchanged
// - flammable: automatic fallback for anything with canBurn set that isn't one of the above
const MATERIAL_TYPES = {
    wood:      { name:'wood',      resistance:1,   hitEffect:'debris', hitColor:new Color(.6,.4,.15) },
    metal:     { name:'metal',     resistance:.5,  hitEffect:'sparks' },
    glass:     { name:'glass',     resistance:1.5, hitEffect:'debris', hitColor:new Color(.8,.9,1,.7) },
    explosive: { name:'explosive', resistance:1,   hitEffect:'sparks' },
    flammable: { name:'flammable', resistance:1,   hitEffect:'debris', hitColor:new Color(.5,.5,.4) },
};

function makeSparks(pos, amount=10)
{
    // small bright sparks for metal impacts - cheap (handful of particles) and short-lived
    const emitter = new ParticleEmitter(
        pos, .1, .04, amount, PI, // pos, emitSize, emitTime, emitRate, emitConeAngle
        undefined, undefined,     // tileIndex, tileSize
        new Color(1,1,.8), new Color(1,.8,.3),     // colorStartA, colorStartB
        new Color(1,.6,.1,0), new Color(1,.3,0,0), // colorEndA, colorEndB
        .2, .06, .01, .5, .2, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .92, .9, .2, PI, .1,  // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .5, 1, 1               // randomness, collideTiles, additive
    );
    emitter.elasticity = .4;
    return emitter;
}

function makeExplosionFlash(pos, radius)
{
    // one bright, very short flash at the blast center - just a couple of particles (cheap),
    // reuses the same additive ParticleEmitter as everything else, not a new effect system
    return new ParticleEmitter(
        pos, radius*.4, .03, 60, PI, // pos, emitSize, emitTime, emitRate, emitConeAngle (~2 particles)
        0, undefined,                // tileIndex, tileSize
        new Color(1,1,.9), new Color(1,.9,.6),       // colorStartA, colorStartB
        new Color(1,.7,.3,0), new Color(1,.5,.1,0),  // colorEndA, colorEndB
        .15, radius*1.5, radius*.3, 0, 0, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        1, 1, 0, PI, 0,   // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .2, 0, 1           // randomness, collideTiles, additive
    );
}

function spawnMaterialHitEffect(pos, material)
{
    if (material.hitEffect == 'sparks')
        makeSparks(pos);
    else
        makeDebris(pos, material.hitColor || new Color, 8);
}

///////////////////////////////////////////////////////////////////////////////
// floating combat text: damage numbers and score popups (combat feedback)
// a single small reusable EngineObject class instead of two parallel effects

class FloatingText extends EngineObject
{
    constructor(pos, text, color=new Color(1,1,1))
    {
        super(pos, vec2(0));
        this.text = text;
        this.textColor = color;
        this.lifeTimer = new Timer(1);
        this.renderOrder = 1e9+1; // draw on top of everything, including additive particles
    }

    update()
    {
        // pure screen-space visual effect - no physics/collision needed, just a lifetime
        this.lifeTimer.elapsed() && this.destroy();
    }

    render()
    {
        // flush any gl-batched sprites queued so far so this direct canvas2D text draw
        // isn't erased by the engine's end-of-frame glCopyToContext call (the same trick
        // TileLayer.render() already uses to mix direct canvas drawing with gl batching)
        glEnable && glCopyToContext(mainContext);

        const p = this.lifeTimer.getPercent();
        const screenPos = worldToScreen(this.pos.add(vec2(0, p*.8)));
        mainContext.save();
        mainContext.globalAlpha = clamp(1-p);
        mainContext.textAlign = 'center';
        mainContext.font = 'bold 16px arial';
        mainContext.fillStyle = this.textColor.rgba();
        mainContext.fillText(this.text, screenPos.x, screenPos.y);
        mainContext.restore();
    }
}

function spawnDamageNumber(pos, amount)
{
    new FloatingText(pos.add(vec2(rand(.3,-.3), .4)), '-'+amount, new Color(1,.3,.2));
}

function spawnScorePopup(pos, amount)
{
    new FloatingText(pos.add(vec2(0, .8)), '+'+amount, new Color(1,.9,.2));
}

///////////////////////////////////////////////////////////////////////////////
// power-up feedback: pickup sparkle, expiration puff, shield-hit spark - all cheap
// (handful of particles), all reusing the same ParticleEmitter system as everything else

function spawnPowerUpPickupEffect(pos, color)
{
    // rising sparkle burst in the power-up's own color, cheap (~18 particles)
    const emitter = new ParticleEmitter(
        pos, .3, .1, 180, PI, // pos, emitSize, emitTime, emitRate, emitConeAngle (~18 particles)
        undefined, undefined, // tileIndex, tileSize
        color, color.scale(.7),             // colorStartA, colorStartB
        color.scale(1,0), color.scale(.6,0), // colorEndA, colorEndB
        .5, .15, .05, .3, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .92, .95, -.05, PI, .1, // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .4, 0, 1                 // randomness, collideTiles, additive
    );
    return emitter;
}

function spawnPowerUpExpireEffect(pos, color)
{
    // small dim puff signalling a buff just wore off, cheaper than the pickup sparkle
    const emitter = new ParticleEmitter(
        pos, .3, .08, 60, PI, // pos, emitSize, emitTime, emitRate, emitConeAngle (~5 particles)
        undefined, undefined, // tileIndex, tileSize
        color.scale(.6), color.scale(.4),   // colorStartA, colorStartB
        color.scale(.5,0), color.scale(.3,0), // colorEndA, colorEndB
        .4, .12, .2, .1, .05, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .9, .9, .1, PI, .2,   // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .4, 0, 0                // randomness, collideTiles, additive
    );
    return emitter;
}

function spawnShieldHitEffect(pos)
{
    // tiny cyan spark when the shield power-up absorbs a hit, distinct from metal sparks
    const emitter = new ParticleEmitter(
        pos, .2, .04, 80, PI, // pos, emitSize, emitTime, emitRate, emitConeAngle (~3 particles)
        undefined, undefined, // tileIndex, tileSize
        new Color(.5,1,1), new Color(.3,.8,1),     // colorStartA, colorStartB
        new Color(.3,1,1,0), new Color(.2,.6,1,0), // colorEndA, colorEndB
        .2, .1, .02, .3, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .92, .9, 0, PI, .1,   // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .4, 0, 1                // randomness, collideTiles, additive
    );
    return emitter;
}

///////////////////////////////////////////////////////////////////////////////
// objective feedback: start/complete/fail cues, all cheap and screen-space (world position is
// usually the camera, since an objective isn't tied to one specific place), reusing the same
// ParticleEmitter system as everything else - no parallel effect system introduced

function spawnObjectiveStartEffect(pos = cameraPos)
{
    makeMuzzleFlash(pos, 0, new Color(1,1,1), 10); // small neutral flash, reused as-is
}

function spawnObjectiveCompleteEffect(pos = cameraPos)
{
    // bright green celebratory burst, cheap (~20 particles)
    const emitter = new ParticleEmitter(
        pos, 1, .15, 130, PI, // pos, emitSize, emitTime, emitRate, emitConeAngle (~20 particles)
        undefined, undefined, // tileIndex, tileSize
        new Color(.4,1,.5), new Color(.7,1,.3),     // colorStartA, colorStartB
        new Color(.3,1,.3,0), new Color(.6,1,.2,0), // colorEndA, colorEndB
        .6, .15, .05, .25, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .92, .95, -.05, PI, .1, // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .4, 0, 1                 // randomness, collideTiles, additive
    );
    return emitter;
}

function spawnObjectiveFailEffect(pos = cameraPos)
{
    // dim red puff, distinct from the green completion burst, cheap (~10 particles)
    const emitter = new ParticleEmitter(
        pos, 1, .1, 100, PI, // pos, emitSize, emitTime, emitRate, emitConeAngle (~10 particles)
        undefined, undefined, // tileIndex, tileSize
        new Color(.8,.2,.2), new Color(.6,.1,.1),   // colorStartA, colorStartB
        new Color(.6,.1,.1,0), new Color(.4,0,0,0), // colorEndA, colorEndB
        .5, .15, .3, .1, .05, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .9, .9, .1, PI, .2,   // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .4, 0, 0                // randomness, collideTiles, additive
    );
    return emitter;
}

///////////////////////////////////////////////////////////////////////////////
// boss feedback: intro announcement, phase transitions, charge trail, melee swipe, death -
// all reuse the existing ParticleEmitter/camera-shake/explosion systems, nothing parallel

function spawnBossIntroEffect(pos)
{
    // big dramatic purple burst announcing the boss, plus a firm camera shake
    shakeCamera(.5, .4);
    const emitter = new ParticleEmitter(
        pos, 2, .3, 150, PI, // pos, emitSize, emitTime, emitRate, emitConeAngle (~45 particles)
        undefined, undefined, // tileIndex, tileSize
        new Color(.8,.2,1), new Color(.5,0,.8),     // colorStartA, colorStartB
        new Color(.6,0,.8,0), new Color(.3,0,.5,0), // colorEndA, colorEndB
        .7, .2, .05, .3, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .92, .95, -.05, PI, .1, // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .4, 0, 1                 // randomness, collideTiles, additive
    );
    return emitter;
}

function spawnBossPhaseTransitionEffect(pos, phase)
{
    // color shifts from orange (phase 2) to red (phase 3, enraged) so the escalation reads
    // clearly; cheap (~25 particles) plus a shake proportional to how serious the phase is
    const color = phase == 3 ? new Color(1,.15,0) : new Color(1,.6,0);
    shakeCamera(.25*phase, .3);
    const emitter = new ParticleEmitter(
        pos, 1.5, .2, 130, PI, // pos, emitSize, emitTime, emitRate, emitConeAngle (~26 particles)
        undefined, undefined,  // tileIndex, tileSize
        color, color.scale(.7),             // colorStartA, colorStartB
        color.scale(1,0), color.scale(.5,0), // colorEndA, colorEndB
        .5, .18, .05, .25, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .9, .9, 0, PI, .1,     // damping, angleDamping, gravityScale, particleConeAngle, fadeRate
        .4, 0, 1                // randomness, collideTiles, additive
    );
    return emitter;
}

function spawnBossChargeEffect(pos, direction)
{
    // quick speed-line trail behind the enraged charge dash, reuses the dash-trail look
    makeDashEffect(pos, direction < 0 ? 0 : PI);
}

function spawnBossMeleeEffect(pos, mirror)
{
    // wide swipe spark in front of the boss
    makeSparks(pos, 14);
}

function spawnBossDeathEffect(pos)
{
    // the boss goes out with a real explosion - full terrain destruction/camera shake/flash/
    // smoke/fire, all completely reused from the existing explosion system
    explosion(pos, 3.5);
}

///////////////////////////////////////////////////////////////////////////////

function explosion(pos, radius=2, chainDepth=0)
{
    ASSERT(radius > 0);
    if (levelWarmup)
        return;

    const damage = radius*2;

    // marker object passed as the "damagingObject" for explosion damage, so downstream code
    // (blood effects, alert(), and the explosiveKill score source) can tell an explosion did
    // this rather than a direct hit - has the same .pos/.velocity shape other damagingObjects
    // have so nothing that reads those fields needs special-casing
    const explosionSource = { pos:pos.copy(), velocity:vec2(), isExplosive:1 };

    // hard safety cap: a chain of explosions triggering further explosions can never nest
    // deeper than this, no matter how densely explosive props are packed on a level
    const maxChainDepth = 8;

    // destroy level - explosions can destroy many tiles at once, so each tile uses a much
    // smaller debris amount than a single bullet-broken tile would (see destroyTile()'s
    // default of 100) to avoid spawning hundreds of unnecessary particles in one frame
    const massDestroyDebrisAmount = 12;
    for(let x = -radius; x < radius; ++x)
    {
        const h = (radius**2 - x**2)**.5;
        for(let y = -h; y <= h; ++y)
            destroyTile(pos.add(vec2(x,y)), 0, 0, 1, massDestroyDebrisAmount);
    }

    // cleanup neighbors
    const cleanupRadius = radius + 1;
    for(let x = -cleanupRadius; x < cleanupRadius; ++x)
    {
        const h = (cleanupRadius**2 - x**2)**.5;
        for(let y = -h; y < h; ++y)
            decorateTile(pos.add(vec2(x,y)).int());
    }

    // kill/push objects, ignite nearby flammables, and chain-trigger nearby explosives
    let nearestPlayerDistance = 1e9;
    const maxRangeSquared = (radius*1.5)**2;
    forEachObject(pos, radius*3, (o)=> 
    {
        const d = o.pos.distance(pos);
        if (o.isGameObject)
        {
            // damage falls off with distance instead of being flat anywhere inside the blast
            // radius - full damage at the center, down to half at the edge of the radius, so
            // radius and damage stay in a balanced, intuitive relationship
            if (d < radius)
                o.damage(damage * (1 - .5*clamp(d/radius)), explosionSource);

            // catch fire - and chain react if this is another explosive that hasn't already
            // been triggered by this (or an earlier) chain reaction
            if (d < radius*1.5 && o.canBurn && !o.isDead() && !o.burnTimer.isSet())
            {
                if (o.explosionSize && !o.chainTriggered && chainDepth < maxChainDepth)
                {
                    // chain reaction: ignite with a fast fuse instead of the normal burn time
                    // so a row of barrels reads as a rapid cascade rather than several
                    // independent multi-second fires. chainTriggered guarantees this object can
                    // only ever be chain-ignited once; chainDepth is the hard loop-safety cap
                    o.chainTriggered = 1;
                    o.chainDepth = chainDepth + 1;
                    o.burnTime = rand(.6, .25);
                    o.burn(1);
                }
                else
                    o.burn();
            }

            if (o.isPlayer && !o.isDead())
                nearestPlayerDistance = min(nearestPlayerDistance, d);
        }

        // push
        const p = percent(d, radius, 2*radius);
        const force = o.pos.subtract(pos).normalize(p*radius*.2 * (o.knockbackMult || 1));
        o.applyForce(force);
        if (o.isDead && o.isDead())
            o.angleVelocity += randSign()*rand(p*radius/4,.3);
    });

    playSound(sound_explosion, pos);
    debugFire && debugCircle(pos, maxRangeSquared**.5, '#f00', 2);
    debugFire && debugCircle(pos, radius**.5, '#ff0', 2);

    // camera shake - stronger for bigger blasts and when a player is close, silent/no-op
    // (and effectively free) when nothing relevant is nearby
    const shakeFalloff = clamp(1 - nearestPlayerDistance/(radius*4));
    shakeFalloff > 0 && shakeCamera(clamp(radius*.15*shakeFalloff, .6, .1), .3);

    // flash - a couple of bright particles at the blast center, cheap but reads strongly
    makeExplosionFlash(pos, radius);

    // smoke
    new ParticleEmitter(
        pos, radius/2, .2, 50*radius, PI, // pos, emitSize, emitTime, emitRate, emiteCone
        0, undefined,        // tileIndex, tileSize
        new Color(0,0,0), new Color(0,0,0), // colorStartA, colorStartB
        new Color(0,0,0,0), new Color(0,0,0,0), // colorEndA, colorEndB
        1, .5, 2, .1, .05, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .9, 1, -.3, PI, .1,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
        .5, 0, 0, 0, 1e8              // randomness, collide, additive, randomColorLinear, renderOrder
    );

    // fire
    new ParticleEmitter(
        pos, radius/2, .1, 100*radius, PI, // pos, emitSize, emitTime, emitRate, emiteCone
        0, undefined,        // tileIndex, tileSize
        new Color(1,.5,.1), new Color(1,.1,.1), // colorStartA, colorStartB
        new Color(1,.5,.1,0), new Color(1,.1,.1,0), // colorEndA, colorEndB
        .5, .5, 2, .1, .05, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
        .9, 1, 0, PI, .05,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
        .5, 0, 1, 0, 1e9              // randomness, collide, additive, randomColorLinear, renderOrder
    );
}

///////////////////////////////////////////////////////////////////////////////

class TileCascadeDestroy extends EngineObject 
{
    constructor(pos, cascadeChance=1, glass=0)
    {
        super(pos, vec2());
        this.cascadeChance = cascadeChance;
        this.destroyTimer = new Timer(glass ? .05 : rand(.3, .1));
    }

    update()
    {
        if (this.destroyTimer.elapsed())
        {
            destroyTile(this.pos, 1, 1, this.cascadeChance);
            this.destroy();
        }
    }
}

function decorateBackgroundTile(pos)
{
    const tileData = getTileBackgroundData(pos);
    if (tileData <= 0)
        return; // no need to clear if background cant change

    // round corners
    for(let i=4;i--;)
    {
        // check corner neighbors
        const neighborTileDataA = getTileBackgroundData(pos.add(vec2().setAngle(i*PI/2)));
        const neighborTileDataB = getTileBackgroundData(pos.add(vec2().setAngle((i+1)%4*PI/2)));

        if (neighborTileDataA > 0 | neighborTileDataB > 0)
            continue;

        const directionVector = vec2().setAngle(i*PI/2+PI/4, 10).int();
        let drawPos = pos.add(vec2(.5))            // center
            .scale(16).add(directionVector).int(); // direction offset

        // clear rect without any scaling to prevent blur from filtering
        const s = 2;
        tileBackgroundLayer.context.clearRect(
            drawPos.x - s/2|0, 
            tileBackgroundLayer.canvas.height - drawPos.y - s/2|0, 
            s|0, s|0);
    }
}

function decorateTile(pos)
{
    ASSERT((pos.x|0) == pos.x && (pos.y|0)== pos.y);
    const tileData = getTileCollisionData(pos);
    if (tileData <= 0)
    {
        tileData || tileLayer.setData(pos, new TileLayerData, 1); // force it to clear if it is empty
        return;
    }

    if (tileData != tileType_dirt &
            tileData != tileType_base &
            tileData != tileType_pipeV &
            tileData != tileType_pipeH &
            tileData != tileType_solid)
        return;

    for(let i=4;i--;)
    {
        // outline towards neighbors of differing type
        const neighborTileData = getTileCollisionData(pos.add(vec2().setAngle(i*PI/2)));
        if (neighborTileData == tileData)
            continue;

        // hacky code to make pixel perfect outlines
        let size = tileData == tileType_dirt ? vec2( rand(16,8), 2) : vec2( 16, 1);
        i&1 && (size = size.flip());

        const color = tileData == tileType_dirt ? levelGroundColor.mutate(.1) : new Color(.1,.1,.1);
        tileLayer.context.fillStyle = color.rgba();
        const drawPos = pos.scale(16);
        if (tileData == tileType_dirt)
            tileLayer.context.fillRect(
                drawPos.x +   ((i==1?14:0)+(i&1?0:8-size.x/2)) |0, 
                tileLayer.canvas.height - drawPos.y + ((i==0?-14:0)-(i&1?8-size.y/2:0)) |0, 
                size.x|0, -size.y|0);
        else
            tileLayer.context.fillRect(
                drawPos.x +  (i==1?15:0) |0, 
                tileLayer.canvas.height - drawPos.y + (i==0?-15:0) |0, 
                size.x|0, -size.y|0);
    }
}

function destroyTile(pos, makeSound = 1, cleanNeighbors = 1, maxCascadeChance = 1, debrisAmount = 100)
{
    // pos must be an int
    pos = pos.int();

    // destroy tile
    const tileType = getTileCollisionData(pos);

    if (!tileType) return 1;                  // empty
    if (tileType == tileType_solid) return 0; // indestructable

    const centerPos = pos.add(vec2(.5));
    const layerData = tileLayer.getData(pos);
    if (layerData)
    {
        // glass material: shatters into a smaller, paler burst instead of the tile's own color
        if (tileType == tileType_glass)
            makeDebris(centerPos, MATERIAL_TYPES.glass.hitColor, min(debrisAmount, 20));
        else
            makeDebris(centerPos, layerData.color.mutate(), debrisAmount);
        makeSound && playSound(sound_destroyTile, centerPos);

        setTileCollisionData(pos, tileType_empty);
        tileLayer.setData(pos, new TileLayerData, 1); // set and clear tile

        // cleanup neighbors
        if (cleanNeighbors)
        {
            for(let i=-1;i<=1;++i)
            for(let j=-1;j<=1;++j)
                decorateTile(pos.add(vec2(i,j)));
        }

        // if weak earth, random chance of delayed destruction of tile directly above
        if (tileType == tileType_glass)
        {
            maxCascadeChance = 1;
            if (getTileCollisionData(pos.add(vec2(0,-1))) == tileType)
                new TileCascadeDestroy(pos.add(vec2(0,-1)), 1, 1);
        }
        else if (tileType != tileType_dirt)
            maxCascadeChance = 0;

        if (rand() < maxCascadeChance && getTileCollisionData(pos.add(vec2(0,1))) == tileType)
            new TileCascadeDestroy(pos.add(vec2(0,1)), maxCascadeChance * .4, tileType == tileType_glass);
    }

    return 1;
}

///////////////////////////////////////////////////////////////////////////////

function drawStars()
{
    randSeed = levelSeed;
    for(let i = lowGraphicsSettings ? 400 : 1e3; i--;)
    {
        let size = randSeeded(6, 1);
        let speed = randSeeded() < .9 ? randSeeded(5) : randSeeded(99,9);
        let color = (new Color).setHSLA(randSeeded(.2,-.3), randSeeded()**9, randSeeded(1,.5), randSeeded(.9,.3));
        if (i < 9)
        {
            // suns or moons
            size = randSeeded()**3*99 + 9;
            speed = randSeeded(5);
            color = (new Color).setHSLA(randSeeded(), randSeeded(), randSeeded(1,.5)).add(levelSkyColor.scale(.5)).clamp();
        }
        
        const w = mainCanvas.width+400, h = mainCanvas.height+400;
        const screenPos = vec2(
            (randSeeded(w)+time*speed)%w-200,
            (randSeeded(h)+time*speed*randSeeded(1,.2))%h-200);

        if (lowGraphicsSettings)
        {
            // drawing stars with gl wont work in low graphics mode, just draw rects
            mainContext.fillStyle = color.rgba();
            if (size < 9)
                mainContext.fillRect(screenPos.x, screenPos.y, size, size);
            else
                mainContext.beginPath(mainContext.fill(mainContext.arc(screenPos.x, screenPos.y, size, 0, 9)));
        }
        else
            drawTileScreenSpace(screenPos, vec2(size), 0, vec2(16), color);
    }
}

function updateSky()
{
    if (!skyParticles)
        return;

    let skyParticlesPos = cameraPos.add(vec2(rand(-40,40),0));
    const raycastHit = tileCollisionRaycast(vec2(skyParticlesPos.x, levelSize.y), vec2(skyParticlesPos.x, 0));
    if (raycastHit && raycastHit.y > cameraPos.y+10)
        skyParticlesPos = raycastHit;
    skyParticles.pos = skyParticlesPos.add(vec2(0,20));
    
    if (rand() < .002)
    {
        skyParticles.emitRate = clamp(skyParticles.emitRate + rand(200,-200), 500);
        skyParticles.angle = clamp(skyParticles.angle + rand(.3,-.3),PI+.5,PI-.5);
    }
   
    if (!levelWarmup && !skySoundTimer.active())
    {
        skySoundTimer.set(rand(2,1));
        playSound(skyRain ? sound_rain : sound_wind, skyParticlesPos, 20, skyParticles.emitRate/1e3);
        if (rand() < .1)
            playSound(sound_wind, skyParticlesPos, 20, rand(skyParticles.emitRate/1e3));
    }
}

///////////////////////////////////////////////////////////////////////////////

let tileParallaxLayers = [];

function generateParallaxLayers()
{
    tileParallaxLayers = [];
    for(let i=0; i<3; ++i)
    {
        const parallaxSize = vec2(600,300), startGroundLevel = rand(99,120)+i*30;
        const tileParallaxLayer = tileParallaxLayers[i] = new TileLayer(vec2(), parallaxSize);
        let groundLevel = startGroundLevel, groundSlope = rand(1,-1);
        tileParallaxLayer.renderOrder = -3e3+i;
        tileParallaxLayer.canvas.width = parallaxSize.x;

        const layerColor = levelColor.mutate(.2).lerp(levelSkyColor,.95-i*.15);
        const gradient = tileParallaxLayer.context.fillStyle = tileParallaxLayer.context.createLinearGradient(0,0,0,tileParallaxLayer.canvas.height = parallaxSize.y);
        gradient.addColorStop(0,layerColor.rgba());
        gradient.addColorStop(1,layerColor.subtract(new Color(1,1,1,0)).mutate(.1).clamp().rgba());

        for(let x=parallaxSize.x;x--;)
        {
            // pull slope towards start ground level
            tileParallaxLayer.context.fillRect(x,groundLevel += groundSlope = rand() < .05 ? rand(1,-1) :
                groundSlope + (startGroundLevel - groundLevel)/2e3,1,parallaxSize.y)
        }
    }
}

function updateParallaxLayers()
{
    tileParallaxLayers.forEach((tileParallaxLayer, i)=>
    {
        const distance = 4+i;
        const parallax = vec2(150,30).scale((i*i+1));
        const cameraDeltaFromCenter = cameraPos.subtract(levelSize.scale(.5)).divide(levelSize.scale(-.5).divide(parallax));
        tileParallaxLayer.scale = vec2(distance/cameraScale);
        tileParallaxLayer.pos = cameraPos
            .subtract(tileParallaxLayer.size.multiply(tileParallaxLayer.scale).scale(.5))
            .add(cameraDeltaFromCenter.scale(1/cameraScale))
            .subtract(vec2(0,150/cameraScale))
    });
}