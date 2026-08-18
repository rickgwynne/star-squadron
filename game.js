(() => {
  'use strict';

  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.imageSmoothingEnabled = false;

  const panel = document.querySelector('#startPanel');
  const startButton = document.querySelector('#startButton');
  const muteButton = document.querySelector('#muteButton');
  const exitButton = document.querySelector('#exitButton');
  const pauseButton = document.querySelector('#pauseButton');
  const autoFireButton = document.querySelector('#autoFireButton');
  const screenWrap = document.querySelector('.screen-wrap');
  const difficultyButtons = [...document.querySelectorAll('[data-difficulty]')];
  const keys = { left: false, right: false, fire: false };
  const TRACTOR_Y = 465;
  let last = performance.now();

  function showMissionControls(show){exitButton.classList.toggle('hidden',!show);pauseButton.classList.toggle('hidden',!show);}
  function resetPauseButton(){pauseButton.textContent='Ⅱ';pauseButton.setAttribute('aria-label','Pause game');pauseButton.setAttribute('aria-pressed','false');}

  const DIFFICULTIES = {
    easy:   { label:'EASY',   lives:4, enemyFire:.16, diveSpeed:.26, diveWave:.012, bulletSpeed:175, bulletWave:6,  diveChance:.010, playerSpeed:310, spawnInv:2.8, captureInv:7 },
    normal: { label:'NORMAL', lives:3, enemyFire:.24, diveSpeed:.30, diveWave:.015, bulletSpeed:195, bulletWave:8,  diveChance:.014, playerSpeed:295, spawnInv:2.2, captureInv:6 },
    hard:   { label:'HARD',   lives:3, enemyFire:.34, diveSpeed:.34, diveWave:.018, bulletSpeed:220, bulletWave:10, diveChance:.018, playerSpeed:285, spawnInv:1.8, captureInv:5 }
  };

  class Synth {
    constructor() { this.ctx = null; this.muted = false; }
    wake() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.ctx.resume(); }
    tone(freq, duration, type = 'square', volume = .035, slide = 0) {
      if (this.muted) return;
      this.wake();
      const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t + duration);
      g.gain.setValueAtTime(volume, t); g.gain.exponentialRampToValueAtTime(.0001, t + duration);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + duration);
    }
    shot() { this.tone(620, .07, 'square', .025, 380); }
    hit() { this.tone(180, .13, 'sawtooth', .05, -120); }
    boom() { this.tone(90, .38, 'sawtooth', .07, -55); }
    beam() {
      if (this.muted) return;
      this.wake();
      const t=this.ctx.currentTime, master=this.ctx.createGain(), carrier=this.ctx.createOscillator(), shimmer=this.ctx.createOscillator(), lfo=this.ctx.createOscillator(), lfoGain=this.ctx.createGain();
      master.gain.setValueAtTime(.0001,t);master.gain.exponentialRampToValueAtTime(.035,t+.08);master.gain.setValueAtTime(.035,t+3.05);master.gain.exponentialRampToValueAtTime(.0001,t+3.4);
      carrier.type='sawtooth';carrier.frequency.setValueAtTime(82,t);carrier.frequency.exponentialRampToValueAtTime(148,t+3.35);
      shimmer.type='triangle';shimmer.frequency.setValueAtTime(246,t);shimmer.frequency.linearRampToValueAtTime(338,t+3.35);
      lfo.type='sine';lfo.frequency.setValueAtTime(3.2,t);lfoGain.gain.setValueAtTime(.018,t);lfo.connect(lfoGain).connect(master.gain);
      carrier.connect(master);shimmer.connect(master);master.connect(this.ctx.destination);
      carrier.start(t);shimmer.start(t);lfo.start(t);carrier.stop(t+3.42);shimmer.stop(t+3.42);lfo.stop(t+3.42);
    }
    rescue() { [440, 660, 880, 1100].forEach((f, i) => setTimeout(() => this.tone(f, .14, 'square', .035), i * 85)); }
    start() { [330, 440, 660].forEach((f, i) => setTimeout(() => this.tone(f, .16, 'square', .035), i * 95)); }
  }
  const sound = new Synth();

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hit = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

  const stars = Array.from({ length: 105 }, () => ({ x: rand(0, W), y: rand(0, H), s: Math.random() < .15 ? 2 : 1, v: rand(18, 85), c: ['#fff', '#50f3ff', '#ff7bc0', '#8e8bff'][Math.floor(rand(0, 4))] }));

  function drawPixelSprite(x, y, pattern, colors, scale = 3, flip = false) {
    const width = pattern[0].length * scale;
    ctx.save(); ctx.translate(Math.round(x - width / 2), Math.round(y - pattern.length * scale / 2));
    if (flip) { ctx.translate(width, 0); ctx.scale(-1, 1); }
    pattern.forEach((row, py) => [...row].forEach((ch, px) => { if (ch !== '.') { ctx.fillStyle = colors[Number(ch) - 1]; ctx.fillRect(px * scale, py * scale, scale, scale); } }));
    ctx.restore();
  }

  const SPRITES = {
    player: [
      '......1......','.....111.....','.....121.....','..3..121..3..','.333.121.333.','3333312133333','3333222223333','...3.2.2.3...','.....4.4.....'
    ],
    bee: ['...1.1...','..11111..','.1122211.','111232111','..12221..','.1.1.1.1.','1.......1'],
    butterfly: ['1.......1','11..2..11','111222111','.1223221.','..23332..','.1.2.2.1.','1.......1'],
    boss: ['...1...1...','1..11.11..1','11112221111','.122333221.','..2333332..','..2345432..','.1.33.33.1','1.1.....1.1']
  };

  class Particle {
    constructor(x, y, color) { this.x=x; this.y=y; this.vx=rand(-130,130); this.vy=rand(-130,130); this.life=rand(.25,.65); this.max=this.life; this.color=color; this.size=rand(2,5); }
    update(dt) { this.x+=this.vx*dt; this.y+=this.vy*dt; this.vx*=.97; this.vy*=.97; this.life-=dt; }
    draw() { ctx.globalAlpha=Math.max(0,this.life/this.max); ctx.fillStyle=this.color; ctx.fillRect(this.x,this.y,this.size,this.size); ctx.globalAlpha=1; }
  }

  class Bullet {
    constructor(x,y,vy,enemy=false) { Object.assign(this,{x,y,vy,enemy,w:enemy?4:3,h:enemy?10:14,dead:false}); }
    update(dt){ this.y += this.vy*dt; if(this.y < -20 || this.y > H+20) this.dead=true; }
    draw(){ ctx.fillStyle=this.enemy?'#ff5a79':'#eaffff'; ctx.shadowColor=this.enemy?'#ff174c':'#50f3ff'; ctx.shadowBlur=8; ctx.fillRect(Math.round(this.x-this.w/2),Math.round(this.y-this.h/2),this.w,this.h); ctx.shadowBlur=0; }
  }

  class Enemy {
    constructor(col,row,type,index) {
      this.col=col; this.row=row; this.type=type; this.index=index; this.baseX=88+col*44; this.baseY=125+row*42;
      this.x=this.baseX; this.y=-50-row*18; this.w=type==='boss'?37:30; this.h=type==='boss'?29:26; this.hp=type==='boss'?2:1; this.state='enter'; this.t= -index*.055; this.dead=false; this.flip=false;
    }
    update(dt, game) {
      this.t += dt;
      const drift=Math.sin(game.time*1.15)*22;
      if(this.state==='enter') {
        const p=clamp(this.t/1.2,0,1), ease=1-Math.pow(1-p,3);
        this.x=this.baseX+drift*ease+Math.sin(p*Math.PI*2)*(1-p)*80; this.y=-40+(this.baseY+40)*ease;
        if(p>=1) { this.state='formation'; this.t=0; }
      } else if(this.state==='formation') {
        this.x=this.baseX+drift; this.y=this.baseY+Math.sin(game.time*2+this.col)*3;
        if(this.carrying && this.t>2.4) { this.state='dive'; this.t=0; this.startX=this.x; this.startY=this.y; game.diveTimer=.7; }
        else if(game.activeEnemies>5 && game.diveTimer<=0 && Math.random()<game.rules.diveChance*dt*60) { this.state='dive'; this.t=0; this.startX=this.x; this.startY=this.y; game.diveTimer=.34; }
      } else if(this.state==='dive') {
        const speed = game.rules.diveSpeed + game.wave*game.rules.diveWave, p=this.t*speed;
        this.x=this.startX + Math.sin(p*Math.PI*2.15)*(110+this.row*13) + (game.player.x-this.startX)*Math.min(1,p)*.24;
        this.y=this.startY + p*570;
        this.flip=Math.sin(p*Math.PI*2.15)>0;
        if(Math.random()<game.rules.enemyFire*dt && this.y>230 && this.y<580) game.enemyBullets.push(new Bullet(this.x,this.y+12,game.rules.bulletSpeed+game.wave*game.rules.bulletWave,true));
        if(this.y>H+45) { this.state='formation'; this.t=0; this.y=-30; }
      } else if(this.state==='captureDive') {
        const p=clamp(this.t/1.72,0,1), ease=p*p*(3-2*p), orbit=Math.sin(p*Math.PI)*76, turn=p*Math.PI*4;
        this.x=this.startX+(this.captureX-this.startX)*ease+Math.sin(turn)*orbit;
        this.y=this.startY+(TRACTOR_Y-this.startY)*ease-Math.cos(turn)*orbit*.24;
        this.captureSpin=turn;this.flip=Math.cos(turn)<0;
        if(p>=1){ this.state='beam'; this.t=0; this.captureSpin=0; sound.beam(); }
      } else if(this.state==='beam') {
        this.x += (this.captureX-this.x)*dt*2.5; this.y=TRACTOR_Y+Math.sin(game.time*4)*3;
        if(this.t>3.4 && !game.captureAnim){ this.state='return'; this.t=0; }
      } else if(this.state==='return') {
        this.y-=185*dt; this.x+=(this.baseX+drift-this.x)*dt*2.3;
        if(this.y<=this.baseY){ this.state='formation'; this.t=0; this.y=this.baseY; }
      }
    }
    draw() {
      const colors = this.type==='boss' ? (this.hp===2 ? ['#baffc9','#39dd73','#139d50','#50f3ff','#fff'] : ['#d9f4ff','#50f3ff','#2874e8','#203aa8','#fff']) : this.type==='butterfly' ? ['#ff4eaa','#5e5cff','#ffe34e'] : ['#50f3ff','#2c63e7','#fff'];
      if(this.state==='beam'){
        const top=this.y+17,bottom=H-43,length=bottom-top,glow=ctx.createLinearGradient(0,top,0,bottom);
        glow.addColorStop(0,'rgba(116,255,130,.26)');glow.addColorStop(.55,'rgba(65,255,105,.10)');glow.addColorStop(1,'rgba(21,190,78,0)');
        ctx.fillStyle=glow;ctx.beginPath();ctx.moveTo(this.x-7,top);ctx.lineTo(this.x-52,bottom);ctx.lineTo(this.x+52,bottom);ctx.lineTo(this.x+7,top);ctx.closePath();ctx.fill();
        ctx.save();ctx.lineCap='round';ctx.shadowColor='#55ff86';ctx.shadowBlur=12;
        for(let i=0;i<7;i++){
          const phase=(this.t*.24+i/7)%1,y=top+phase*length,rx=10+phase*43,ry=4+phase*10,alpha=.28+(1-phase)*.68;
          ctx.strokeStyle=`rgba(105,255,139,${alpha})`;ctx.lineWidth=phase<.18?3:2;
          ctx.beginPath();ctx.ellipse(this.x,y,rx,ry,0,0,Math.PI);ctx.stroke();
        }
        ctx.restore();
      }
      if(this.state==='captureDive'){
        ctx.save();ctx.translate(this.x,this.y);ctx.rotate(this.captureSpin||0);ctx.shadowColor='#6dff9b';ctx.shadowBlur=15;
        drawPixelSprite(0,0,SPRITES[this.type],colors,this.type==='boss'?3.25:3,this.flip);ctx.restore();
        ctx.strokeStyle='rgba(109,255,155,.55)';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(this.x,this.y,24+Math.sin(this.t*13)*5,10,0,0,Math.PI*2);ctx.stroke();
      } else drawPixelSprite(this.x,this.y,SPRITES[this.type],colors,this.type==='boss'?3.25:3,this.flip);
      if(this.carrying) drawPixelSprite(this.x,this.y+(this.state==='dive'?-31:31),SPRITES.player,['#b7b4c7','#77758c','#4f5068','#ff4eaa'],2.4,true);
    }
  }

  class ChallengeEnemy {
    constructor(group,index,round){
      this.group=group;this.index=index;this.round=round;this.t=-(1.25+group*5.35+index*.115);this.duration=Math.max(4.3,5.2-round*.05);this.x=W/2;this.y=-40;this.w=28;this.h=24;this.dead=false;this.active=false;this.escaped=false;this.flip=index%2===0;
      this.type=group===0?'bee':group<3?'butterfly':'boss';
    }
    update(dt){
      this.t+=dt;if(this.t<0)return;this.active=true;const p=this.t/this.duration;if(p>=1){this.dead=true;this.escaped=true;return;}
      if(this.group===0){
        this.x=W/2+Math.sin(p*Math.PI*2)*148;this.y=-35+p*(H+70);
      }else if(this.group===1){
        this.x=W/2+Math.sin(p*Math.PI*4)*118;this.y=-35+p*(H+70);this.flip=Math.cos(p*Math.PI*4)<0;
      }else if(this.group===2){
        const side=this.index%2===0?-1:1;this.x=side<0?-35+p*(W+70):W+35-p*(W+70);this.y=105+Math.sin(p*Math.PI)*390;this.flip=side>0;
      }else if(this.group===3){
        const radius=175*(1-p*.35);this.x=W/2+Math.cos(p*Math.PI*5)*radius;this.y=-25+p*(H+55);this.flip=Math.sin(p*Math.PI*5)<0;
      }else{
        this.x=W/2+Math.sin(p*Math.PI*6)*108;this.y=-30+p*(H+65)+Math.sin(p*Math.PI*3)*34;this.flip=Math.cos(p*Math.PI*6)<0;
      }
    }
    draw(){
      if(!this.active||this.dead)return;
      const palettes=[['#50f3ff','#2869e8','#fff'],['#ff4eaa','#704aff','#ffe34e'],['#ffe34e','#ff4eaa','#fff'],['#a95cff','#ff4eaa','#50f3ff','#ffe34e','#fff'],['#6dff9b','#27aeda','#fff','#ffe34e','#ff4eaa']];
      drawPixelSprite(this.x,this.y,SPRITES[this.type],palettes[this.group],this.type==='boss'?2.55:2.8,this.flip);
    }
  }

  class Game {
    constructor(){
      this.high=Number(localStorage.getItem('starSquadronHigh')||10000); this.difficulty=localStorage.getItem('starSquadronDifficulty')||'normal';if(!DIFFICULTIES[this.difficulty])this.difficulty='normal';this.rules=DIFFICULTIES[this.difficulty];this.autoFire=localStorage.getItem('starSquadronAutoFire')==='true';this.mode='title'; this.time=0; this.particles=[]; this.bullets=[]; this.enemyBullets=[]; this.wave=1; this.score=0; this.lives=this.rules.lives; this.message=''; this.messageTimer=0; this.captureAnim=null; this.rescueShip=null; this.capturedBoss=null;this.challenge=false;this.challengeEnding=false; this.resetPlayer();
    }
    setDifficulty(level){if(this.mode==='playing'||!DIFFICULTIES[level])return;this.difficulty=level;this.rules=DIFFICULTIES[level];localStorage.setItem('starSquadronDifficulty',level);difficultyButtons.forEach(b=>b.classList.toggle('active',b.dataset.difficulty===level));}
    setAutoFire(enabled){this.autoFire=enabled;localStorage.setItem('starSquadronAutoFire',String(enabled));autoFireButton.setAttribute('aria-pressed',String(enabled));autoFireButton.textContent=`AUTO-FIRE: ${enabled?'ON':'OFF'}`;sound.wake();}
    resetPlayer(inv=this.rules.spawnInv){ this.player={x:W/2,y:H-70,w:30,h:25,cool:0,inv,dead:false,dual:false}; }
    begin(){
      this.score=0; this.lives=this.rules.lives; this.wave=1; this.mode='playing'; this.time=0; this.particles=[]; this.bullets=[]; this.enemyBullets=[]; this.captureAnim=null; this.rescueShip=null; this.capturedBoss=null;this.challenge=false;this.challengeEnding=false; this.resetPlayer(); this.spawnStage(); panel.classList.add('hidden');resetPauseButton();showMissionControls(true);sound.start();
    }
    isChallengeStage(stage){return stage>=3&&(stage-3)%4===0;}
    spawnStage(){if(this.isChallengeStage(this.wave))this.spawnChallenge();else this.spawnWave();}
    spawnWave(){
      this.challenge=false;this.challengeEnding=false;this.challengeSummary=null;
      this.enemies=[]; let i=0;
      for(let row=0;row<5;row++) for(let col=0;col<8;col++) { const type=row===0?'boss':row<3?'butterfly':'bee'; this.enemies.push(new Enemy(col,row,type,i++)); }
      this.diveTimer=2; this.captureTimer=this.wave===1?3.8:6.5; this.message=`STAGE ${this.wave}`; this.messageTimer=2.2;
    }
    spawnChallenge(){
      this.challenge=true;this.challengeEnding=false;this.challengeSummary=null;this.enemyBullets=[];this.bullets=[];this.captureAnim=null;this.rescueShip=null;this.capturedBoss=null;this.challengeHits=0;this.challengeGroupHits=[0,0,0,0,0];this.challengeGroupBonus=0;this.challengeRound=Math.floor((this.wave-3)/4)+1;
      this.enemies=[];for(let group=0;group<5;group++)for(let i=0;i<8;i++)this.enemies.push(new ChallengeEnemy(group,i,this.challengeRound));
      this.player.inv=999;this.message='CHALLENGING STAGE';this.messageTimer=2.4;sound.start();
    }
    challengeGroupValue(){return this.challengeRound<=2?1000:this.challengeRound<=4?1500:this.challengeRound<=6?2000:3000;}
    hitChallengeEnemy(enemy){
      enemy.dead=true;this.challengeHits++;this.challengeGroupHits[enemy.group]++;this.score+=100;this.explode(enemy.x,enemy.y,['#fff','#ffe34e','#50f3ff']);sound.hit();
      if(this.challengeGroupHits[enemy.group]===8){const bonus=this.challengeGroupValue();this.challengeGroupBonus+=bonus;this.score+=bonus;this.message=`GROUP PERFECT +${bonus}`;this.messageTimer=1.25;sound.rescue();}
    }
    finishChallenge(){
      if(this.challengeEnding)return;this.challengeEnding=true;const perfect=this.challengeHits===40,perfectBonus=perfect?10000:0;if(perfectBonus){this.score+=perfectBonus;sound.rescue();}
      this.challengeSummary={hits:this.challengeHits,shotBonus:this.challengeHits*100,groupBonus:this.challengeGroupBonus,perfect,perfectBonus};this.challengeEndTimer=4.8;this.bullets=[];this.message='';this.messageTimer=0;
    }
    explode(x,y,colors=['#ff4eaa','#50f3ff','#ffe34e']){ for(let i=0;i<18;i++) this.particles.push(new Particle(x,y,colors[i%colors.length])); }
    fire(){
      const limit=this.player.dual?6:3;
      if(this.player.cool<=0 && !this.player.dead && this.bullets.length<limit){
        if(this.player.dual){this.bullets.push(new Bullet(this.player.x-10,this.player.y-18,-510),new Bullet(this.player.x+10,this.player.y-18,-510));}
        else this.bullets.push(new Bullet(this.player.x,this.player.y-18,-510));
        this.player.cool=.19;sound.shot();
      }
    }
    beginCapture(boss){
      if(this.captureAnim||this.player.dead||this.player.dual)return;
      this.player.dead=true;this.bullets=[];this.captureAnim={boss,t:0,x:this.player.x,y:this.player.y,startX:this.player.x,startY:this.player.y,rotation:0,complete:false};this.message='TRACTOR LOCK';this.messageTimer=1.7;
    }
    finishCapture(anim){
      anim.complete=true;anim.boss.carrying=true;anim.boss.state='return';anim.boss.t=0;this.capturedBoss=anim.boss;this.lives--;this.message='FIGHTER CAPTURED';this.messageTimer=2.1;this.enemyBullets=[];
      if(this.lives<=0){setTimeout(()=>this.gameOver(),650);return;}
      this.respawnTimer=1;this.respawnInv=this.rules.captureInv;this.captureAnim=null;
    }
    rescue(boss){
      boss.carrying=false;this.capturedBoss=null;this.rescueShip={x:boss.x,y:boss.y+(boss.state==='dive'?-28:28),t:0};this.message='FIGHTER RESCUED';this.messageTimer=2.2;this.enemyBullets=[];sound.rescue();
    }
    destroyCaptive(boss){ const cy=boss.y+(boss.state==='dive'?-31:31);boss.carrying=false;this.capturedBoss=null;this.score+=1000;this.explode(boss.x,cy,['#aaa','#ff4eaa','#fff']);this.message='CAPTIVE LOST';this.messageTimer=1.8;sound.boom(); }
    loseLife(){
      if(this.player.inv>0 || this.player.dead) return;
      if(this.player.dual){this.player.dual=false;this.player.w=30;this.player.inv=2;this.lives--;this.explode(this.player.x+12,this.player.y,['#fff','#50f3ff','#ff4eaa']);sound.boom();this.message='WING FIGHTER LOST';this.messageTimer=1.5;if(this.lives<=0)this.gameOver();return;}
      this.player.dead=true; this.explode(this.player.x,this.player.y,['#fff','#50f3ff','#ff4eaa']); sound.boom(); this.lives--;
      setTimeout(()=>{ if(this.lives<=0) this.gameOver(); else this.resetPlayer(); },900);
    }
    gameOver(){
      this.mode='gameover';showMissionControls(false);resetPauseButton(); if(this.score>this.high){ this.high=this.score; localStorage.setItem('starSquadronHigh',this.high); }
      panel.querySelector('.badge').textContent='MISSION OVER'; panel.querySelector('h2').textContent=this.score>=this.high?'NEW HIGH SCORE':'GAME OVER'; panel.querySelector('.subtitle').textContent=`SCORE ${String(this.score).padStart(6,'0')}`; startButton.textContent='PLAY AGAIN'; panel.classList.remove('hidden');
    }
    update(dt){
      this.time+=dt; stars.forEach(s=>{s.y+=s.v*dt;if(s.y>H){s.y=0;s.x=rand(0,W);}}); this.particles.forEach(p=>p.update(dt)); this.particles=this.particles.filter(p=>p.life>0);
      if(this.mode!=='playing') return;
      this.messageTimer-=dt; this.diveTimer-=dt; this.captureTimer-=dt; this.player.cool-=dt; this.player.inv-=dt;
      if(this.challengeEnding){this.challengeEndTimer-=dt;if(this.challengeEndTimer<=0){this.wave++;this.player.inv=this.rules.spawnInv;this.spawnStage();}return;}
      if(this.respawnTimer!=null){this.respawnTimer-=dt;if(this.respawnTimer<=0){this.resetPlayer(this.respawnInv||1.8);this.respawnInv=null;this.respawnTimer=null;}}
      if(this.captureAnim){
        const a=this.captureAnim;a.t+=dt;const p=clamp(a.t/2.75,0,1),ease=p*p*(3-2*p);
        const baseX=a.startX+(a.boss.x-a.startX)*ease,baseY=a.startY+(a.boss.y+22-a.startY)*ease;
        a.x=baseX;a.y=baseY;a.rotation=p*Math.PI*8;
        if(p>=1&&!a.complete)this.finishCapture(a);
      }
      if(this.rescueShip){const r=this.rescueShip;r.t+=dt;r.x+=(this.player.x-r.x)*dt*3.5;r.y+=(this.player.y-r.y)*dt*3.5;if(r.t>1.25){this.player.dual=true;this.player.w=52;this.player.inv=2;this.rescueShip=null;this.message='DUAL FIGHTER';this.messageTimer=2;sound.rescue();}}
      if(!this.player.dead){ const dx=(keys.right?1:0)-(keys.left?1:0); this.player.x=clamp(this.player.x+dx*this.rules.playerSpeed*dt,24,W-24); if(keys.fire||this.autoFire) this.fire(); }
      this.enemies.forEach(e=>e.update(dt,this)); this.bullets.forEach(b=>b.update(dt)); this.enemyBullets.forEach(b=>b.update(dt));
      if(this.challenge){
        for(const b of this.bullets)for(const e of this.enemies)if(!b.dead&&!e.dead&&e.active&&hit(b,e)){b.dead=true;this.hitChallengeEnemy(e);}
        this.bullets=this.bullets.filter(b=>!b.dead);this.enemies=this.enemies.filter(e=>!e.dead);this.activeEnemies=this.enemies.length;if(this.enemies.length===0)this.finishChallenge();return;
      }
      if(this.captureTimer<=0&&!this.capturedBoss&&!this.captureAnim&&!this.player.dual&&!this.player.dead&&this.lives>1){const boss=this.enemies.find(e=>e.type==='boss'&&e.state==='formation');if(boss){boss.state='captureDive';boss.t=0;boss.startX=boss.x;boss.startY=boss.y;boss.captureX=this.player.x;this.captureTimer=14;this.message='COMMANDER INBOUND';this.messageTimer=1.4;}}
      const beamer=this.enemies.find(e=>e.state==='beam');if(beamer&&beamer.t>1.05&&!this.captureAnim&&!this.player.dead&&Math.abs(this.player.x-beamer.x)<42)this.beginCapture(beamer);
      for(const b of this.bullets) for(const e of this.enemies) if(!b.dead&&!e.dead){
        if(e.carrying&&hit(b,{x:e.x,y:e.y+(e.state==='dive'?-31:31),w:28,h:24})){b.dead=true;this.destroyCaptive(e);continue;}
        if(hit(b,e)){b.dead=true;e.hp--;sound.hit();this.explode(b.x,b.y,['#fff','#ffe34e']);if(e.hp<=0){if(e.carrying&&e.state==='dive')this.rescue(e);else if(e.carrying)this.destroyCaptive(e);e.dead=true;this.score+=e.type==='boss'?400:e.state==='dive'?200:100;this.explode(e.x,e.y);}}
      }
      for(const b of this.enemyBullets) if(!b.dead&&hit(b,this.player)){b.dead=true;this.loseLife();}
      for(const e of this.enemies) if(!e.dead&&e.state==='dive'&&hit(e,this.player)){e.dead=true;this.explode(e.x,e.y);this.loseLife();}
      this.bullets=this.bullets.filter(b=>!b.dead); this.enemyBullets=this.enemyBullets.filter(b=>!b.dead); this.enemies=this.enemies.filter(e=>!e.dead); this.activeEnemies=this.enemies.length;
      if(this.enemies.length===0){ this.wave++; this.enemyBullets=[]; this.spawnStage(); }
    }
    drawBackground(){
      ctx.fillStyle='#03030e';ctx.fillRect(0,0,W,H);
      stars.forEach(s=>{ctx.globalAlpha=.4+Math.sin(this.time*3+s.x)*.35;ctx.fillStyle=s.c;ctx.fillRect(Math.round(s.x),Math.round(s.y),s.s,s.s*2);});ctx.globalAlpha=1;
      const g=ctx.createLinearGradient(0,0,W,0);g.addColorStop(0,'transparent');g.addColorStop(.5,'rgba(76,51,180,.16)');g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(0,82,W,1);
    }
    drawHud(){
      ctx.font='12px "Press Start 2P", monospace';ctx.textAlign='left';ctx.fillStyle='#ff4eaa';ctx.fillText('1UP',18,24);ctx.fillStyle='#fff';ctx.fillText(String(this.score).padStart(6,'0'),18,43);
      ctx.textAlign='center';ctx.fillStyle='#a9a4c9';ctx.fillText('HIGH SCORE',W/2,24);ctx.fillStyle='#fff';ctx.fillText(String(Math.max(this.high,this.score)).padStart(6,'0'),W/2,43);
      ctx.textAlign='right';ctx.fillStyle=this.challenge?'#ffe34e':'#50f3ff';ctx.fillText(`${this.challenge?'BONUS':'STAGE'} ${this.wave}`,W-18,28);ctx.font='8px "Press Start 2P", monospace';ctx.fillStyle=this.difficulty==='hard'?'#ff4eaa':this.difficulty==='easy'?'#6dff9b':'#ffe34e';ctx.fillText(this.rules.label,W-18,44);
      for(let i=0;i<Math.max(0,this.lives-1);i++) drawPixelSprite(20+i*22,H-20,SPRITES.player,['#fff','#50f3ff','#4385ff','#ff4eaa'],1.2);
    }
    draw(){
      this.drawBackground(); this.drawHud();
      this.enemies?.forEach(e=>e.draw()); this.bullets.forEach(b=>b.draw()); this.enemyBullets.forEach(b=>b.draw()); this.particles.forEach(p=>p.draw());
      if(this.captureAnim){
        const a=this.captureAnim;ctx.save();ctx.translate(a.x,a.y);ctx.rotate(a.rotation);ctx.shadowColor='#6dff9b';ctx.shadowBlur=16;
        drawPixelSprite(0,0,SPRITES.player,['#fff','#50f3ff','#4385ff','#ff4eaa'],3,true);ctx.restore();
      }
      if(this.rescueShip) drawPixelSprite(this.rescueShip.x,this.rescueShip.y,SPRITES.player,['#fff','#50f3ff','#4385ff','#ff4eaa'],2.7,true);
      if(!this.player.dead && (this.player.inv<=0 || Math.floor(this.player.inv*10)%2===0)){
        if(this.player.dual){drawPixelSprite(this.player.x-11,this.player.y,SPRITES.player,['#fff','#50f3ff','#4385ff','#ff4eaa'],3);drawPixelSprite(this.player.x+11,this.player.y,SPRITES.player,['#fff','#50f3ff','#4385ff','#ff4eaa'],3);}
        else drawPixelSprite(this.player.x,this.player.y,SPRITES.player,['#fff','#50f3ff','#4385ff','#ff4eaa'],3);
      }
      if(this.messageTimer>0){ctx.globalAlpha=Math.min(1,this.messageTimer);ctx.textAlign='center';ctx.font='20px "Press Start 2P"';ctx.fillStyle='#ffe34e';ctx.fillText(this.message,W/2,H/2);ctx.globalAlpha=1;}
      if(this.challenge&&!this.challengeEnding){ctx.textAlign='center';ctx.font='8px "Press Start 2P"';ctx.fillStyle='#a9a4c9';ctx.fillText(`${this.challengeHits} / 40 TARGETS`,W/2,67);}
      if(this.challengeEnding&&this.challengeSummary){
        const s=this.challengeSummary;ctx.fillStyle='rgba(3,3,18,.86)';ctx.fillRect(28,205,W-56,310);ctx.strokeStyle=s.perfect?'#ffe34e':'#50f3ff';ctx.lineWidth=2;ctx.strokeRect(28,205,W-56,310);ctx.textAlign='center';ctx.font='16px "Press Start 2P"';ctx.fillStyle=s.perfect?'#ffe34e':'#50f3ff';ctx.fillText(s.perfect?'PERFECT!':'STAGE COMPLETE',W/2,250);ctx.font='10px "Press Start 2P"';ctx.fillStyle='#fff';ctx.fillText(`TARGETS  ${String(s.hits).padStart(2,'0')} / 40`,W/2,302);ctx.fillText(`HIT SCORE  ${String(s.shotBonus).padStart(5,'0')}`,W/2,343);ctx.fillText(`GROUP BONUS  ${String(s.groupBonus).padStart(5,'0')}`,W/2,384);if(s.perfect){ctx.fillStyle='#ff4eaa';ctx.fillText('SPECIAL BONUS  10000',W/2,431);}ctx.fillStyle='#a9a4c9';ctx.font='8px "Press Start 2P"';ctx.fillText('NO FIGHTERS LOST',W/2,477);
      }
      if(this.mode==='paused'){ctx.fillStyle='rgba(3,3,14,.75)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';ctx.font='22px "Press Start 2P"';ctx.fillStyle='#50f3ff';ctx.fillText('PAUSED',W/2,H/2);}
    }
  }

  const game = new Game();
  game.setDifficulty(game.difficulty);
  autoFireButton.setAttribute('aria-pressed',String(game.autoFire));
  autoFireButton.textContent=`AUTO-FIRE: ${game.autoFire?'ON':'OFF'}`;
  function loop(now){ const dt=Math.min(.033,(now-last)/1000);last=now;if(game.mode!=='paused')game.update(dt);game.draw();requestAnimationFrame(loop); }
  requestAnimationFrame(loop);

  function setKey(code,value){ if(['ArrowLeft','KeyA'].includes(code))keys.left=value;if(['ArrowRight','KeyD'].includes(code))keys.right=value;if(['Space','KeyZ'].includes(code))keys.fire=value; }
  addEventListener('keydown',e=>{ if(['ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();setKey(e.code,true);if(e.code==='Enter'&&(game.mode==='title'||game.mode==='gameover'))game.begin();if(e.code==='KeyP'&&['playing','paused'].includes(game.mode))togglePause(); });
  addEventListener('keyup',e=>setKey(e.code,false));
  addEventListener('blur',()=>{keys.left=keys.right=keys.fire=false;if(game.mode==='playing')togglePause();});
  startButton.addEventListener('click',()=>game.begin());
  difficultyButtons.forEach(button=>button.addEventListener('click',()=>game.setDifficulty(button.dataset.difficulty)));
  autoFireButton.addEventListener('click',()=>game.setAutoFire(!game.autoFire));
  muteButton.addEventListener('click',()=>{sound.muted=!sound.muted;muteButton.classList.toggle('off',sound.muted);muteButton.textContent=sound.muted?'×':'♪';});

  function togglePause(){
    if(game.mode==='playing'){game.mode='paused';pauseButton.textContent='▶';pauseButton.setAttribute('aria-label','Resume game');pauseButton.setAttribute('aria-pressed','true');}
    else if(game.mode==='paused'){game.mode='playing';resetPauseButton();sound.wake();}
  }
  pauseButton.addEventListener('click',togglePause);
  exitButton.addEventListener('click',()=>{
    keys.left=keys.right=keys.fire=false;game.mode='title';game.bullets=[];game.enemyBullets=[];game.captureAnim=null;game.rescueShip=null;
    panel.querySelector('.badge').textContent='1 UP';panel.querySelector('h2').textContent='STAR SQUADRON';panel.querySelector('.subtitle').textContent='DEFEND THE LAST CONSTELLATION';startButton.textContent='START MISSION';
    panel.classList.remove('hidden');showMissionControls(false);resetPauseButton();
  });

  let drag=null;
  screenWrap.addEventListener('pointerdown',e=>{
    if(game.mode!=='playing'||e.target.closest('button'))return;
    e.preventDefault();sound.wake();
    try{screenWrap.setPointerCapture(e.pointerId);}catch{}
    drag={id:e.pointerId,startX:e.clientX,playerX:game.player.x};screenWrap.classList.add('dragging');
  });
  screenWrap.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId||game.mode!=='playing')return;
    e.preventDefault();const scale=W/canvas.getBoundingClientRect().width;
    game.player.x=clamp(drag.playerX+(e.clientX-drag.startX)*scale,24,W-24);
  });
  function endDrag(e){if(!drag||drag.id!==e.pointerId)return;drag=null;screenWrap.classList.remove('dragging');}
  screenWrap.addEventListener('pointerup',endDrag);
  screenWrap.addEventListener('pointercancel',endDrag);
})();
