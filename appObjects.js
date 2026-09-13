/*
    Javascript Space Game
    By aashuu  

*/

'use strict';

class GameObject extends EngineObject 
{
    constructor(pos, size, tileIndex, tileSize, angle)
    {
        super(pos, size, tileIndex, tileSize, angle);
        this.isGameObject = 1;
        this.health = this.healthMax = 0;
        this.burnDelay = .1;
        this.burnTime = 3;
        this.damageTimer = new Timer;
        this.burnDelayTimer = new Timer;
        this.burnTimer = new Timer;
        this.extinguishTimer = new Timer;
        this.hitEffectTimer = new Timer; // rate-limits material hit-effect particles (see damage())
        this.color = new Color;
        this.additiveColor = new Color(0,0,0,0);
    }

    inUpdateWindow() { return levelWarmup || isOverlapping(this.pos, this.size, cameraPos, updateWindowSize); }

    update()
    {
        if (this.parent || this.persistent || !this.groundObject || this.inUpdateWindow()) // pause physics if outside update window
            super.update();

        if (!this.isLavaRock)
        {
            if (!this.isDead() && this.damageTimer.isSet())
            {
                // flash white when damaged
                const a = .5*percent(this.damageTimer.get(), 0, .15);
                this.additiveColor = new Color(a,a,a,0);
            }
            else
                this.additiveColor = new Color(0,0,0,0);
        }
        
        if (!this.parent && this.pos.y < -1)
        {
            // kill and destroy if fall below level
            this.kill();
            this.persistent || this.destroy();
        }
        else if (this.burnTime)
        {
            if (this.burnTimer.isSet())
            {
                // burning
                if (this.burnTimer.elapsed())
                {
                    this.kill();
                    if (this.fireEmitter)
                        this.fireEmitter.emitRate = 0;
                }
                else if (rand() < .01)
                {
                    // random chance to spread fire
                    const spreadRadius = 2;
                    debugFire && debugCircle(this.pos, spreadRadius, '#f00', 1);
                    forEachObject(this.pos, spreadRadius, (o)=>o.isGameObject && o.burn());
                }
            }
            else if (this.burnDelayTimer.elapsed())
            {
                // finished waiting to burn
                this.burn(1);
            }
        }
    }
 
    render()
    {
        drawTile(this.pos, this.size, this.tileIndex, this.tileSize, this.color.scale(this.burnColorPercent(),1), this.angle, this.mirror, this.additiveColor);
    }
    
    burnColorPercent() { return lerp(this.burnTimer.getPercent(), .2, 1); }

    burn(instant)
    {
        if (!this.canBurn || this.burnTimer.isSet() || this.extinguishTimer.active())
            return;

        if (godMode && this.isPlayer)
            return;

        if (this.team == team_player)
        {
            // safety window after spawn
            if (godMode || this.getAliveTime() < 2)
                return;
        }

        if (instant)
        {
            this.burnTimer.set(this.burnTime*rand(1.5, 1));
            this.fireEmitter = makeFire();
            this.addChild(this.fireEmitter);
        }
        else
            this.burnDelayTimer.isSet() || this.burnDelayTimer.set(this.burnDelay*rand(1.5, 1));
    }

    extinguish()
    {
        if (this.fireEmitter && this.fireEmitter.emitRate == 0)
            return;

        // stop burning
        this.extinguishTimer.set(.1);
        this.burnTimer.unset();
        this.burnDelayTimer.unset();
        if (this.fireEmitter)
            this.fireEmitter.destroy();
        this.fireEmitter = 0;
    }
    
    heal(health)
    {
        assert(health >= 0);
        if (this.isDead())
            return 0;
        
        // apply healing and return amount healed
        return this.health - (this.health = min(this.health + health, this.healthMax));
    }

    damage(damage, damagingObject)
    {
        ASSERT(damage >= 0);
        if (this.isDead())
            return 0;

        // material-based resistance + hit feedback (metal resists more and sparks on impact,
        // wood/glass/flammable splinter into small debris) - purely additive on top of the
        // existing damage-flash/kill flow below, and a no-op for anything without a material
        // assigned (Character/Checkpoint/Grenade are all completely unaffected by this)
        if (this.material)
        {
            damage *= this.material.resistance;
            if (this.hitEffectTimer.elapsed())
            {
                spawnMaterialHitEffect(this.pos, this.material);
                this.hitEffectTimer.set(.1); // rate limit so rapid fire doesn't spam particles
            }
        }

        // set damage timer;
        this.damageTimer.set();
        for(const child of this.children)
            child.damageTimer && child.damageTimer.set();

        // apply damage and kill if necessary
        const newHealth = max(this.health - damage, 0);
        if (!newHealth)
            this.kill(damagingObject);

        // set new health and return amount damaged
        return this.health - (this.health = newHealth);
    }

    isDead()                { return !this.health; }
    kill(damagingObject)    { this.destroy(); }

    collideWithObject(o)
    {
        if (o.isLavaRock && this.canBurn)
        {
            if (levelWarmup)
            {
                this.destroy();
                return 1;
            }
            this.burn();
        }
        return 1;
    }
}

///////////////////////////////////////////////////////////////////////////////

const propType_crate_wood           = 0;
const propType_crate_explosive      = 1;
const propType_crate_metal          = 2;
const propType_barrel_explosive     = 3;
const propType_barrel_water         = 4;
const propType_barrel_metal         = 5;
const propType_barrel_highExplosive = 6;
const propType_rock                 = 7;
const propType_rock_lava            = 8;
const propType_count                = 9;

class Prop extends GameObject 
{
    constructor(pos, typeOverride) 
    { 
        super(pos);

        const type = this.type = (typeOverride != undefined ? typeOverride : rand()**2*propType_count|0);
        let health = 5;
        this.tileIndex = 16;
        this.explosionSize = 0;
        this.chainTriggered = this.chainDepth = 0; // chain-reaction bookkeeping, see explosion()
        if (this.type == propType_crate_wood)
        {
            this.color = new Color(1,.5,0);
            this.canBurn = 1;
            this.material = MATERIAL_TYPES.wood;
        }
        else if (this.type == propType_crate_metal)
        {
            this.color = new Color(.9,.9,1);
            health = 10;
            this.material = MATERIAL_TYPES.metal;
        }
        else if (this.type == propType_crate_explosive)
        {
            this.color = new Color(.2,.8,.2);
            this.canBurn = 1;
            this.explosionSize = 2;
            health = 1e3;
            this.material = MATERIAL_TYPES.explosive;
        }
        else if (this.type == propType_barrel_metal)
        {
            this.tileIndex = 17;
            this.color = new Color(.9,.9,1);
            health = 10;
            this.material = MATERIAL_TYPES.metal;
        }
        else if (this.type == propType_barrel_explosive)
        {
            this.tileIndex = 17;
            this.color = new Color(.2,.8,.2);
            this.canBurn = 1;
            this.explosionSize = 2;
            health = 1e3;
            this.material = MATERIAL_TYPES.explosive;
        }
        else if (this.type == propType_barrel_highExplosive)
        {
            this.tileIndex = 17;
            this.color = new Color(1,.1,.1);
            this.canBurn = 1;
            this.explosionSize = 3;
            this.burnTimeDelay = 0;
            this.burnTime = rand(.5,.1);
            health = 1e3;
            this.material = MATERIAL_TYPES.explosive;
        }
        else if (this.type == propType_barrel_water)
        {
            this.tileIndex = 17;
            this.color = new Color(0,.6,1);
            health = .01;
        }
        else if (this.type == propType_rock || this.type == propType_rock_lava)
        {
            this.tileIndex = 18;
            this.color = new Color(.8,.8,.8).mutate(.2);
            health = 30;
            this.mass *= 4;
            this.material = MATERIAL_TYPES.metal;
            if (rand() < .2)
            {
                health = 99;
                this.mass *= 4;
                this.size = this.size.scale(2);
                this.pos.y += .5;
            }
            this.isCrushing = 1;

            if (this.type == propType_rock_lava)
            {
                this.color = new Color(1,.9,0);
                this.additiveColor = new Color(1,0,0);
                this.isLavaRock = 1;    
            }
        }

        // any other flammable prop that wasn't given a more specific material above (wood,
        // metal, explosive) still gets full fire-system integration via this fallback material
        if (!this.material && this.canBurn)
            this.material = MATERIAL_TYPES.flammable;

        // randomly angle and flip axis (90 degree rotation)
        this.angle = (rand(4)|0)*PI/2;
        if (rand() < .5)
            this.size = this.size.flip();

        this.mirror = rand() < .5;
        this.health = this.healthMax = health;
        this.setCollision(1, 1);
    }
 
    update()
    {
        const oldVelocity = this.velocity.copy();
        super.update();

        // apply collision damage
        const deltaSpeedSquared = this.velocity.subtract(oldVelocity).lengthSquared();
        deltaSpeedSquared > .05 && this.damage(2*deltaSpeedSquared);
    }

    damage(damage, damagingObject)
    {
        (this.explosionSize || this.type == propType_crate_wood && rand() < .1) && this.burn();
        super.damage(damage, damagingObject);
    }

    kill()
    {
        if (this.destroyed) return;

        if (this.type == propType_barrel_water)
            makeWater(this.pos);

        this.destroy();
        makeDebris(this.pos, this.color.scale(this.burnColorPercent(),1));
        
        this.explosionSize ? 
            explosion(this.pos, this.explosionSize, this.chainDepth) :
            playSound(sound_destroyTile, this.pos);
    }
}

///////////////////////////////////////////////////////////////////////////////
// power-up system - data-driven table (same pattern as WEAPON_TYPES/MATERIAL_TYPES), so
// adding a new power-up later just means adding an entry here. Instant effects (health) are
// applied once on pickup; everything else is a timed buff tracked on the player (see
// Player.updatePowerUps()/applyPowerUp()/onPowerUpExpired() in appCharacters.js), reusing the
// existing speedMult/damageMult fields already used by the sprint and enemy-behavior systems.

const powerUp_health      = 'health';
const powerUp_armor       = 'armor';
const powerUp_damageBoost = 'damageBoost';
const powerUp_speedBoost  = 'speedBoost';
const powerUp_rapidFire   = 'rapidFire';
const powerUp_shield      = 'shield';

const POWERUP_TYPES =
{
    [powerUp_health]:      { name:'Health',       color:new Color(1,.2,.2),  instant:1, healAmount:5 },
    [powerUp_armor]:       { name:'Armor',        color:new Color(.6,.6,.75),duration:20, value:.5  },  // blocks 50% of incoming damage
    [powerUp_damageBoost]: { name:'Damage Boost', color:new Color(1,.5,0),   duration:15, value:1.75}, // 1.75x weapon damage
    [powerUp_speedBoost]:  { name:'Speed Boost',  color:new Color(.2,.6,1),  duration:12, value:1.5 }, // 1.5x movement speed
    [powerUp_rapidFire]:   { name:'Rapid Fire',   color:new Color(1,1,.2),   duration:10, value:2   }, // 2x fire rate
    [powerUp_shield]:      { name:'Shield',       color:new Color(.3,1,1),   duration:15, shieldAmount:8 }, // extra absorbing health buffer
};
const POWERUP_TYPE_KEYS = Object.keys(POWERUP_TYPES);

class PowerUp extends GameObject
{
    constructor(pos, powerUpType)
    {
        super(pos, vec2(.6));
        this.powerUpType = powerUpType;
        this.color = POWERUP_TYPES[powerUpType].color;
        this.renderOrder = 5;
        this.bobOffset = rand(9); // desyncs the bob/spin animation between pickups
        // no setCollision() call - like Checkpoint, this is a pure trigger object with no
        // physics; pickup is a simple distance check in update(), not the collision system
    }

    update()
    {
        if (!this.inUpdateWindow())
            return; // ignore offscreen objects, same pattern as Checkpoint

        for(const player of players)
        {
            if (player && !player.isDead() && this.pos.distanceSquared(player.pos) < 1)
            {
                applyPowerUp(player, this.powerUpType);
                playSound(sound_powerup, this.pos);
                spawnPowerUpPickupEffect(this.pos, this.color);
                this.destroy();
                break;
            }
        }
    }

    render()
    {
        // simple colored diamond (two overlapping rects), same untextured-rect approach Bullet
        // already uses - no new art/tile-sheet dependency needed
        const bob = Math.sin(time*3 + this.bobOffset)*.08;
        const spin = Math.sin(time*2 + this.bobOffset)*.3;
        const pos = this.pos.add(vec2(0, .3+bob));
        drawRect(pos, this.size, new Color(1,1,1,.5), PI/4+spin);
        drawRect(pos, this.size.scale(.6), this.color, PI/4+spin);
    }
}

///////////////////////////////////////////////////////////////////////////////

let checkpointPos, activeCheckpoint, checkpointTimer = new Timer;

class Checkpoint extends GameObject 
{
    constructor(pos)
    {
        super(pos.int().add(vec2(.5)))
        this.renderOrder = tileRenderOrder-1;
        this.isCheckpoint = 1;
        for(let x=3;x--;)
        for(let y=6;y--;)
            setTileCollisionData(pos.subtract(vec2(x-1,1-y)), y ? tileType_empty : tileType_solid);
    }

    update()
    {
        if (!this.inUpdateWindow())
            return; // ignore offscreen objects

        // check if player is near
        for(const player of players)
            player && !player.isDead() && this.pos.distanceSquared(player.pos) < 1 && this.setActive();
    }

    setActive()
    {
        if (activeCheckpoint != this && !levelWarmup)
            playSound(sound_checkpoint, this.pos);

        checkpointPos = this.pos;
        activeCheckpoint = this;
        checkpointTimer.set(.1);
    }

    render()
    {
        // draw flag
        const height = 4;
        const color = activeCheckpoint == this ? new Color(1,0,0) : new Color;
        const a = Math.sin(time*4+this.pos.x);
        drawTile(this.pos.add(vec2(.5,height-.3-.5-.03*a)), vec2(1,.6), 14, undefined, color, a*.06);  
        drawRect(this.pos.add(vec2(0,height/2-.5)), vec2(.1,height), new Color(.9,.9,.9));
    }
}

///////////////////////////////////////////////////////////////////////////////

class Grenade extends GameObject
{
    constructor(pos) 
    {
        super(pos, vec2(.2), 5, vec2(8));

        this.health = this.healthMax = 1e3;
        this.beepTimer = new Timer(1);
        this.elasticity = .3;
        this.friction   = .9;
        this.angleDamping = .96;
        this.renderOrder = 1e8;
        this.setCollision();
    }

    update()
    {
        super.update();

        if (this.getAliveTime() > 3)
        {
            explosion(this.pos, 3);
            this.destroy();
            return;
        }

        if (this.beepTimer.elapsed())
        {
            playSound(sound_grenade, this.pos)
            this.beepTimer.set(1);
        }

        alertEnemies(this.pos, this.pos);
    }
       
    render()
    {
        drawTile(this.pos, vec2(.5), this.tileIndex, this.tileSize, this.color, this.angle);

        const a = this.getAliveTime();
        setBlendMode(1);
        drawTile(this.pos, vec2(2), 0, vec2(16), new Color(1,0,0,.2-.2*Math.cos(a*2*PI)));
        drawTile(this.pos, vec2(1), 0, vec2(16), new Color(1,0,0,.2-.2*Math.cos(a*2*PI)));
        drawTile(this.pos, vec2(.5), 0, vec2(16), new Color(1,1,1,.2-.2*Math.cos(a*2*PI)));
        setBlendMode(0);
    }
}

///////////////////////////////////////////////////////////////////////////////
// weapon type definitions - adding a new weapon later just means adding an entry here,
// everything else (switching, ammo/reload state, HUD, firing) is fully data-driven

const weaponType_pistol  = 0;
const weaponType_shotgun = 1;
const weaponType_rifle   = 2;
const weaponType_heavy   = 3;

const WEAPON_TYPES = [
    { // 0: Pistol - identical stats to the original single weapon, default feel is unchanged
        name: 'Pistol', fireRate: 8, bulletSpeed: .5, spread: .1, damage: 1, bulletsPerShot: 1,
        range: 8, magazineSize: 12, reserveAmmoStart: 48, reloadTime: 1,
        recoilAngle: .2, recoilTime: .4, pushback: 0, splashRadius: 0, damageFalloff: 0,
        cameraShake: 0, muzzleFlashAmount: 20, color: new Color(.85,.85,.85),
    },
    { // 1: Shotgun - many pellets, wide spread, short range, damage falls off with distance
      // so it hits hardest up close
        name: 'Shotgun', fireRate: 1.4, bulletSpeed: .45, spread: .35, damage: 1, bulletsPerShot: 7,
        range: 4.5, magazineSize: 6, reserveAmmoStart: 24, reloadTime: 1.6,
        recoilAngle: .55, recoilTime: .5, pushback: .07, splashRadius: 0, damageFalloff: 1,
        cameraShake: 0, muzzleFlashAmount: 45, color: new Color(1,.6,.1),
    },
    { // 2: Automatic rifle - fast fire rate, tight spread, quick recoil recovery = stable shooting
        name: 'Rifle', fireRate: 14, bulletSpeed: .6, spread: .05, damage: 1, bulletsPerShot: 1,
        range: 10, magazineSize: 30, reserveAmmoStart: 90, reloadTime: 1.4,
        recoilAngle: .09, recoilTime: .18, pushback: 0, splashRadius: 0, damageFalloff: 0,
        cameraShake: 0, muzzleFlashAmount: 18, color: new Color(.3,.9,.3),
    },
    { // 3: Heavy weapon - slow, hits hard, splash damage + camera shake, big particle impact
        name: 'Heavy', fireRate: 1.8, bulletSpeed: .4, spread: .05, damage: 5, bulletsPerShot: 1,
        range: 9, magazineSize: 5, reserveAmmoStart: 15, reloadTime: 2.2,
        recoilAngle: .7, recoilTime: .6, pushback: .18, splashRadius: 1.5, damageFalloff: 0,
        cameraShake: .2, muzzleFlashAmount: 70, color: new Color(1,.2,.2),
    },
];

class Weapon extends EngineObject 
{
    constructor(pos, parent, weaponType=0) 
    { 
        super(pos, vec2(.6), 4, vec2(8));

        // weapon settings
        this.isWeapon = 1;
        this.fireTimeBuffer = this.localAngle = 0;
        this.recoilTimer = new Timer;
        this.switchTimer = new Timer;      // drives the weapon-switch animation and briefly blocks firing
        this.emptyClickTimer = new Timer;  // rate-limits the dry-fire click when out of ammo

        // modular multi-weapon state: every weapon type keeps its own independent magazine,
        // reserve ammo and reload timer, so switching weapons never loses ammo or interrupts
        // an in-progress reload (it keeps counting down even while a different weapon is active)
        this.weaponType = weaponType;
        this.ammoState = WEAPON_TYPES.map(def => ({
            magazineAmmo: def.magazineSize,
            reserveAmmo: def.reserveAmmoStart,
            reloadTimer: new Timer,
        }));

        this.addChild(this.shellEmitter = new ParticleEmitter(
            vec2(), 0, 0, 0, .1,  // pos, emitSize, emitTime, emitRate, emiteCone
            undefined, undefined, // tileIndex, tileSize
            new Color(1,.8,.5), new Color(.9,.7,.5), // colorStartA, colorStartB
            new Color(1,.8,.5), new Color(.9,.7,.5), // colorEndA, colorEndB
            3, .1, .1, .15, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
            1, .95, 1, 0, 0,    // damping, angleDamping, gravityScale, particleCone, fadeRate, 
            .1, 1              // randomness, collide, additive, randomColorLinear, renderOrder
        ));
        this.shellEmitter.elasticity = .5;
        this.shellEmitter.particleDestroyCallback = persistentParticleDestroyCallback;
        this.renderOrder = parent.renderOrder+1;
        this.color = WEAPON_TYPES[weaponType].color;

        parent.weapon = this;
        parent.addChild(this, this.localOffset = vec2(.55,0));
    }

    get weaponDef() { return WEAPON_TYPES[this.weaponType]; }
    get ammo()      { return this.ammoState[this.weaponType]; }

    switchWeapon(newType)
    {
        if (newType == this.weaponType || newType < 0 || newType >= WEAPON_TYPES.length)
            return;

        this.weaponType = newType;
        this.color = this.weaponDef.color;

        // reset transient per-shot state so switching can never carry over a half-charged
        // fire buffer or a mid-recoil angle from the previous weapon (avoids shooting glitches)
        this.fireTimeBuffer = 0;
        this.localAngle = 0;
        this.recoilTimer.unset();

        // brief switch animation, also blocks firing for its duration
        this.switchTimer.set(.3);
        playSound(sound_switchWeapon, this.pos);
    }

    startReload()
    {
        const ammo = this.ammo, def = this.weaponDef;
        if (ammo.reloadTimer.active() || ammo.magazineAmmo >= def.magazineSize || ammo.reserveAmmo <= 0)
            return;

        ammo.reloadTimer.set(def.reloadTime);
        playSound(sound_reload, this.pos);
    }

    update()
    {
        super.update();

        const def = this.weaponDef, ammo = this.ammo;
        const isPlayerWeapon = this.parent.isPlayer; // enemies keep their original unlimited-ammo behavior
        this.mirror = this.parent.mirror;
        this.fireTimeBuffer += timeDelta;

        if (isPlayerWeapon)
        {
            // weapon switch / manual reload input (keyboard for player 0, gamepad bumper for any local player)
            if (!this.parent.playerIndex)
            {
                // G/H/J/K select a weapon directly. Plain number keys 1/2/3 are intentionally NOT used
                // here: engineDebug.js already binds them to debugPhysics/debugParticles/godMode, and
                // since this build ships with `debug = 1`, reusing 1/2/3 would silently toggle godMode
                // etc while trying to switch weapons. F1-F4 were considered too, but browsers intercept
                // F1 for their own Help menu (the engine never calls preventDefault on keydown), so G/H/J/K
                // are used instead - free of any existing binding and no browser default behavior.
                keyWasPressed(71) && this.switchWeapon(weaponType_pistol);  // G
                keyWasPressed(72) && this.switchWeapon(weaponType_shotgun); // H
                keyWasPressed(74) && this.switchWeapon(weaponType_rifle);   // J
                keyWasPressed(75) && this.switchWeapon(weaponType_heavy);   // K
                keyWasPressed(76) && this.startReload(); // L = reload ("R" is already bound to full game restart)
            }
            if (gamepadWasPressed(4, this.parent.playerIndex)) // left bumper: cycle to next weapon
                this.switchWeapon((this.weaponType+1) % WEAPON_TYPES.length);

            // finish reload once the timer elapses
            if (ammo.reloadTimer.elapsed())
            {
                const amount = min(def.magazineSize - ammo.magazineAmmo, ammo.reserveAmmo);
                ammo.magazineAmmo += amount;
                ammo.reserveAmmo -= amount;
                ammo.reloadTimer.unset();
            }

            // auto reload once the magazine runs dry (only if there's reserve ammo to pull from)
            if (!ammo.magazineAmmo && !ammo.reloadTimer.isSet() && ammo.reserveAmmo > 0)
                this.startReload();
        }

        if (this.recoilTimer.active())
            this.localAngle = lerp(this.recoilTimer.getPercent(), 0, this.localAngle);

        // weapon switch animation: dip the weapon down and back up
        if (this.switchTimer.active())
            this.localAngle = Math.sin(this.switchTimer.getPercent()*PI) * -1.4;

        const reloading = isPlayerWeapon && ammo.reloadTimer.active();
        const outOfAmmo = isPlayerWeapon && ammo.magazineAmmo <= 0;
        const canFire = this.triggerIsDown && !this.switchTimer.active() && !reloading;

        if (canFire && outOfAmmo)
        {
            // dry-fire click feedback so an empty magazine is never silent, rate limited
            // so holding the trigger doesn't spam the sound every frame
            if (this.emptyClickTimer.elapsed())
            {
                playSound(sound_emptyClick, this.pos);
                this.emptyClickTimer.set(.3);
            }
            this.fireTimeBuffer = min(this.fireTimeBuffer, 0);
        }
        else if (canFire)
        {
            // slow down enemy bullets, same as before
            const speed = def.bulletSpeed * (isPlayerWeapon ? 1 : .5);
            const rate = 1/(def.fireRate * (this.parent.fireRateMult || 1));
            for(; this.fireTimeBuffer > 0 && (!isPlayerWeapon || ammo.magazineAmmo > 0); this.fireTimeBuffer -= rate)
            {
                this.localAngle = -rand(def.recoilAngle, def.recoilAngle*.75);
                this.recoilTimer.set(rand(def.recoilTime, def.recoilTime*.75));
                isPlayerWeapon && --ammo.magazineAmmo;

                const baseVelocity = vec2(this.getMirrorSign(speed), 0);
                for(let i = def.bulletsPerShot; i--;)
                {
                    const bullet = new Bullet(this.pos, this.parent);
                    bullet.velocity = baseVelocity.rotate(rand(def.spread,-def.spread));
                    bullet.damage = def.damage * (this.parent.damageMult || 1);
                    bullet.range = bullet.initialRange = def.range;
                    bullet.splashRadius = def.splashRadius;
                    bullet.damageFalloff = def.damageFalloff;
                }

                this.shellEmitter.localAngle = -.8*this.getMirrorSign();
                this.shellEmitter.emitParticle();
                makeMuzzleFlash(this.pos, vec2(this.getMirrorSign(1),0).angle(), def.color, def.muzzleFlashAmount);
                playSound(sound_shoot, this.pos);

                def.pushback && this.parent.applyForce(vec2(-this.getMirrorSign(def.pushback),0));
                def.cameraShake && isPlayerWeapon && shakeCamera(def.cameraShake, .15);

                // alert enemies
                isPlayerWeapon && alertEnemies(this.pos, this.pos);
            }
        }
        else
            this.fireTimeBuffer = min(this.fireTimeBuffer, 0);
    }
}

///////////////////////////////////////////////////////////////////////////////

class Bullet extends EngineObject 
{
    constructor(pos, attacker) 
    { 
        super(pos, vec2(0));
        this.color = new Color(1,1,0,1);
        this.lastVelocity = this.velocity;
        this.setCollision();

        this.damage = this.damping = 1;
        this.gravityScale = 0;
        this.attacker = attacker;
        this.team = attacker.team;
        this.renderOrder = 1e9;
        this.range = this.initialRange = 8;
        this.splashRadius = 0;  // set by Weapon.update() for splash weapons (e.g. heavy)
        this.damageFalloff = 0; // set by Weapon.update() for range-falloff weapons (e.g. shotgun)
    }

    update()
    {
        this.lastVelocity = this.velocity;
        super.update();

        this.range -= this.velocity.length();
        if (this.range < 0)
        {
            const emitter = new ParticleEmitter(
                this.pos, .2, .1, 100, PI, // pos, emitSize, emitTime, emitRate, emiteCone
                0, undefined,     // tileIndex, tileSize
                new Color(1,1,0,.5), new Color(1,1,1,.5), // colorStartA, colorStartB
                new Color(1,1,0,0), new Color(1,1,1,0), // colorEndA, colorEndB
                .1, .5, .1, .1, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
                1, 1, .5, PI, .1,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
                .5, 0, 1           // randomness, collide, additive, randomColorLinear, renderOrder
            );

            this.destroy();
            return;
        }

        // check if hit someone
        forEachObject(this.pos, this.size, (o)=>
        {
            if (o.isGameObject && !o.parent && o.team != this.team)
            if (!o.dodgeTimer || !o.dodgeTimer.active())
                this.collideWithObject(o)
        });
    }
    
    // damage this bullet deals right now, accounting for range falloff (e.g. shotgun pellets)
    getCurrentDamage()
    {
        if (!this.damageFalloff || !this.initialRange)
            return this.damage;

        const traveledPercent = clamp(1 - this.range/this.initialRange);
        return max(1, Math.round(this.damage * lerp(traveledPercent, .3, 1)));
    }

    // small area-of-effect hit for splash-capable weapons (e.g. the heavy weapon)
    applySplash()
    {
        if (!this.splashRadius)
            return;

        forEachObject(this.pos, this.splashRadius, (o)=>
        {
            if (o.isGameObject && o.team != this.team && !o.isDead()
                && o.pos.distanceSquared(this.pos) < this.splashRadius**2)
                o.damage(max(1, this.damage>>1), this);
        });
        makeWeaponImpact(this.pos, 60, new Color(1,.6,.2));
    }

    collideWithObject(o)
    {
        if (o.isGameObject)
        {
            o.damage(this.getCurrentDamage(), this);
            o.applyForce(this.velocity.scale(.1 * (o.knockbackMult || 1)));
            this.applySplash();
            if (o.isCharacter)
            {
                playSound(sound_walk, this.pos);
                this.destroy();
            }
            else
                this.kill();
        }
    
        return 1; 
    }

    collideWithTile(data, pos)
    {
        if (data <= 0)
            return 0;
            
        const destroyTileChance = data == tileType_glass ? 1 : data == tileType_dirt ? .2 : .05;
        rand() < destroyTileChance && destroyTile(pos);
        this.applySplash();
        this.kill();

        return 1; 
    }

    kill()
    {
        if (this.destroyed)
            return;

        const emitter = new ParticleEmitter(
            this.pos, 0, .1, 100, .5, // pos, emitSize, emitTime, emitRate, emiteCone
            undefined, undefined,     // tileIndex, tileSize
            new Color(1,1,0), new Color(1,0,0), // colorStartA, colorStartB
            new Color(1,1,0), new Color(1,0,0), // colorEndA, colorEndB
            .2, .2, 0, .1, .1, // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
            1, 1, .5, PI, .1,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
            .5, 1, 1           // randomness, collide, additive, randomColorLinear, renderOrder
        );
        emitter.trailScale = 1;
        emitter.angle = this.lastVelocity.angle() + PI;
        emitter.elasticity = .3;

        this.destroy();
    }

    render()
    {
        drawRect(this.pos, vec2(.4,.5), new Color(1,1,1,.5), this.velocity.angle());
        drawRect(this.pos, vec2(.2,.5), this.color, this.velocity.angle());
    }
}