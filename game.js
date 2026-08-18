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
    extra() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, .18, 'square', .04), i * 95)); }
    start() { [330, 440, 660].forEach((f, i) => setTimeout(() => this.tone(f, .16, 'square', .035), i * 95)); }
  }
  const sound = new Synth();

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hit = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

  function sampleArcadeRoute(points, progress) {
    const p=clamp(progress,0,.999999),span=points.length-1,scaled=p*span,i=Math.floor(scaled),t=scaled-i;
    const p0=points[Math.max(0,i-1)],p1=points[i],p2=points[Math.min(span,i+1)],p3=points[Math.min(span,i+2)];
    const curve=(a,b,c,d)=>.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
    return {x:curve(p0[0],p1[0],p2[0],p3[0]),y:curve(p0[1],p1[1],p2[1],p3[1])};
  }

  const mirrorRoute=points=>points.map(([x,y])=>[1-x,y]);
  const ARCADE_CHALLENGE_ROUTES={
    hookRight:[[.50,-.08],[.50,.10],[.46,.28],[.35,.48],[.23,.66],[.28,.82],[.48,.75],[.67,.55],[.78,.30],[.72,.10],[.58,-.08]],
    hookLeft:null,
    longHookRight:[[.50,-.08],[.50,.12],[.43,.31],[.27,.48],[.15,.68],[.26,.91],[.52,.82],[.73,.58],[.84,.30],[.74,.08],[.58,-.08]],
    longHookLeft:null,
    fountainLeft:[[.47,-.08],[.46,.17],[.43,.39],[.38,.65],[.27,.86],[.08,.87],[-.08,.68],[.03,.39],[.24,.22],[.45,.14],[.53,-.08]],
    fountainRight:null,
    centreS:[[.50,-.08],[.50,.13],[.42,.27],[.32,.43],[.42,.57],[.61,.66],[.69,.79],[.57,.92],[.39,.81],[.31,.62],[.42,.45],[.59,.29],[.62,.10],[.55,-.08]],
    centreSMirror:null,
    sideLoopLeft:[[-.08,.18],[.15,.20],[.34,.34],[.38,.55],[.24,.70],[.08,.61],[.12,.42],[.31,.35],[.50,.48],[.58,.72],[.48,1.08]],
    sideLoopRight:null,
    figureEight:[[.50,-.08],[.50,.13],[.33,.28],[.25,.47],[.38,.61],[.61,.47],[.72,.29],[.61,.16],[.39,.30],[.28,.50],[.40,.70],[.63,.78],[.78,.92],[.84,1.08]],
    figureEightMirror:null,
    cloverLeft:[[.50,-.08],[.49,.15],[.34,.23],[.22,.39],[.30,.55],[.48,.49],[.38,.34],[.21,.47],[.27,.67],[.49,.72],[.42,.88],[.24,1.08]],
    cloverRight:null,
    wideCrownLeft:[[-.08,.12],[.15,.18],[.34,.31],[.46,.48],[.34,.66],[.14,.72],[.09,.51],[.28,.39],[.50,.51],[.55,.75],[.42,1.08]],
    wideCrownRight:null,
    lowSweepLeft:[[.50,-.08],[.49,.18],[.38,.39],[.22,.63],[.08,.84],[-.08,.86],[.12,.70],[.35,.62],[.55,.71],[.72,.90],[.78,1.08]],
    lowSweepRight:null,
    spiralLeft:[[.50,-.08],[.48,.14],[.31,.24],[.20,.43],[.31,.61],[.52,.59],[.63,.40],[.51,.27],[.34,.37],[.35,.56],[.54,.70],[.73,.83],[.86,1.08]],
    spiralRight:null,
    commanderLeft:[[.48,-.08],[.46,.13],[.31,.26],[.18,.43],[.22,.63],[.40,.75],[.50,.62],[.42,.45],[.25,.56],[.22,.79],[.41,.90],[.53,1.08]],
    commanderRight:null
  };
  for(const pair of [['hookLeft','hookRight'],['longHookLeft','longHookRight'],['fountainRight','fountainLeft'],['centreSMirror','centreS'],['sideLoopRight','sideLoopLeft'],['figureEightMirror','figureEight'],['cloverRight','cloverLeft'],['wideCrownRight','wideCrownLeft'],['lowSweepRight','lowSweepLeft'],['spiralRight','spiralLeft'],['commanderRight','commanderLeft']])ARCADE_CHALLENGE_ROUTES[pair[0]]=mirrorRoute(ARCADE_CHALLENGE_ROUTES[pair[1]]);

  // Five fixed eight-ship strings for each of the arcade game's eight-stage bonus cycle.
  // Split entries use the first route for ships 1-4 and its partner for ships 5-8.
  const ARCADE_CHALLENGE_WAVES=[
    [['hookRight'],['hookLeft'],['longHookRight'],['longHookLeft'],['commanderLeft','commanderRight']],
    [['fountainLeft','fountainRight'],['hookRight','hookLeft'],['sideLoopLeft','sideLoopRight'],['fountainRight','fountainLeft'],['commanderLeft','commanderRight']],
    [['centreS'],['centreSMirror'],['figureEight'],['figureEightMirror'],['commanderLeft','commanderRight']],
    [['sideLoopLeft','sideLoopRight'],['wideCrownLeft','wideCrownRight'],['cloverLeft'],['cloverRight'],['commanderLeft','commanderRight']],
    [['spiralLeft'],['spiralRight'],['fountainLeft','fountainRight'],['figureEight','figureEightMirror'],['commanderLeft','commanderRight']],
    [['lowSweepLeft','lowSweepRight'],['centreS','centreSMirror'],['cloverLeft','cloverRight'],['wideCrownLeft','wideCrownRight'],['commanderLeft','commanderRight']],
    [['figureEight','figureEightMirror'],['spiralLeft','spiralRight'],['sideLoopLeft','sideLoopRight'],['lowSweepLeft','lowSweepRight'],['commanderLeft','commanderRight']],
    [['wideCrownLeft','wideCrownRight'],['cloverLeft','cloverRight'],['figureEight','figureEightMirror'],['spiralLeft','spiralRight'],['commanderLeft','commanderRight']]
  ];

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
    bee: ['....1....','...121...','..12221..','.1122211.','111232111','1..222..1','...1.1...','..1...1..'],
    butterfly: ['1.......1','11..2..11','111222111','.1223221.','..23332..','.1122211.','1.1...1.1','1.......1'],
    boss: ['1...1.1...1','.1..111..1.','11112221111','.1223333221.','..2334332..','..2345432..','.123333321.','1.1.3.3.1.1','...1...1...'],
    dragonfly: ['1...1...1','11..1..11','.1122211.','..12321..','...232...','..1.2.1..','.1..2..1.','1...2...1'],
    scorpion: ['11.....11','.11.1.11.','..12221..','.1233321.','..23332..','...232...','..1.2.1..','.1.....1.'],
    satellite: ['....1....','..1.2.1..','111232111','.1233321.','..23332..','111232111','..1.2.1..','....1....'],
    stingray: ['1.......1','.11...11.','..11211..','.1223221.','112333211','..23332..','...2.2...','....2....'],
    flagship: ['1...1...1','.1.222.1.','112333211','.1234321.','..23432..','...232...','..1...1..','1.......1'],
    enterprise: ['....1....','...111...','..12221..','111232111','.1233321.','..23432..','.1.2.2.1.','1.......1']
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
      this.entryBatch=Math.floor(index/8);this.entrySlot=index%8;this.x=this.baseX;this.y=-50;this.w=type==='boss'?40:30;this.h=type==='boss'?32:26;this.hp=type==='boss'?2:1;this.state='enter';this.t=-(this.entryBatch*1.45+this.entrySlot*.105);this.dead=false;this.flip=false;this.route=this.entryBatch;this.entrySide=this.entryBatch%2===0?-1:1;this.escortLeader=null;
    }
    update(dt, game) {
      this.t += dt;
      const drift=Math.sin(game.time*1.15)*22;
      if(this.state==='enter') {
        const p=clamp(this.t/1.62,0,1),side=this.entrySide,slot=(this.entrySlot-3.5)*5,arrival=clamp((p-.55)/.45,0,1),ease=arrival*arrival*(3-2*arrival);let pathX,pathY;
        if(this.route===0){pathX=-36+p*320+Math.sin(p*Math.PI*2.2)*98+slot;pathY=-28+p*310+Math.sin(p*Math.PI)*130;}
        else if(this.route===1){pathX=W+36-p*320-Math.sin(p*Math.PI*2.2)*98-slot;pathY=-28+p*310+Math.sin(p*Math.PI)*130;}
        else if(this.route===2){pathX=W/2+Math.cos(p*Math.PI*2.6+slot*.012)*166;pathY=-38+p*345+Math.sin(p*Math.PI*2.6)*62;}
        else if(this.route===3){pathX=side<0?-38+p*440:W+38-p*440;pathY=75+Math.sin(p*Math.PI)*255+Math.sin(p*Math.PI*3)*36;}
        else {pathX=W/2+side*Math.sin(p*Math.PI*3.2)*145+slot;pathY=-35+p*330+Math.sin(p*Math.PI*2)*70;}
        this.x=lerp(pathX,this.baseX+drift,ease);this.y=lerp(pathY,this.baseY,ease);this.flip=Math.cos(p*Math.PI*(2.2+this.route*.18))*side>0;
        if(p>=1) { this.state='formation'; this.t=0; }
      } else if(this.state==='formation') {
        this.x=this.baseX+drift; this.y=this.baseY+Math.sin(game.time*2+this.col)*3;
        if(this.carrying && this.t>2.4) { this.state='dive'; this.t=0; this.startX=this.x; this.startY=this.y; game.diveTimer=.7; }
        else if(game.activeEnemies>5 && game.diveTimer<=0 && Math.random()<game.rules.diveChance*dt*60) {
          this.state='dive';this.t=0;this.startX=this.x;this.startY=this.y;game.diveTimer=.34;
          if(this.type==='boss'&&!this.carrying){
            const escorts=game.enemies.filter(e=>e!==this&&e.type==='butterfly'&&e.state==='formation').sort((a,b)=>Math.abs(a.x-this.x)-Math.abs(b.x-this.x)).slice(0,2);
            escorts.forEach((escort,i)=>{escort.state='dive';escort.t=0;escort.startX=escort.x;escort.startY=escort.y;escort.escortLeader=this;escort.escortOffset=i===0?-34:34;});
          }
        }
      } else if(this.state==='dive') {
        if(this.escortLeader){
          if(this.escortLeader.dead||this.escortLeader.state!=='dive'){this.state='formation';this.t=0;this.y=-30;this.escortLeader=null;return;}
          this.x=this.escortLeader.x+this.escortOffset;this.y=this.escortLeader.y+17;this.flip=this.escortLeader.flip;
          if(Math.random()<game.rules.enemyFire*.55*dt&&this.y>230&&this.y<560)game.enemyBullets.push(new Bullet(this.x,this.y+12,game.rules.bulletSpeed+game.wave*game.rules.bulletWave,true));
          return;
        }
        const speed = game.rules.diveSpeed + game.wave*game.rules.diveWave, p=this.t*speed;
        const aim=(game.player.x-this.startX)*Math.min(1,p);
        if(this.type==='bee'){
          this.x=this.startX+Math.sin(p*Math.PI*2.25)*(118+this.row*12)+aim*.25;this.y=this.startY+p*570;this.flip=Math.cos(p*Math.PI*2.25)<0;
        }else if(this.type==='butterfly'){
          this.x=this.startX+Math.sin(p*Math.PI*3.15)*(88+this.row*10)+Math.sin(p*Math.PI)*aim*.2;this.y=this.startY+p*570+Math.sin(p*Math.PI*2)*24;this.flip=Math.cos(p*Math.PI*3.15)<0;
        }else{
          const hook=Math.sin(Math.min(1,p)*Math.PI);this.x=this.startX+Math.sin(p*Math.PI*1.72)*142+aim*.3*hook;this.y=this.startY+p*540-Math.sin(p*Math.PI)*30;this.flip=Math.cos(p*Math.PI*1.72)<0;
        }
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
      this.group=group;this.index=index;this.round=round;this.pattern=(round-1)%8;this.t=-(1.8+group*5.85+index*.118);this.duration=Math.max(4.55,5.35-Math.min(round-1,7)*.07);this.x=W/2;this.y=-40;this.dead=false;this.active=false;this.escaped=false;this.flip=index%2===0;
      const featured=['bee','butterfly','dragonfly','scorpion','satellite','stingray','flagship','enterprise'][this.pattern];
      this.type=group===4&&index>=4?'boss':featured;this.hp=this.type==='boss'?2:1;this.w=this.type==='boss'?39:29;this.h=this.type==='boss'?33:25;
      const wave=ARCADE_CHALLENGE_WAVES[this.pattern][group];this.routeName=wave.length===1?wave[0]:wave[index<4?0:1];this.route=ARCADE_CHALLENGE_ROUTES[this.routeName];
    }
    update(dt){
      this.t+=dt;if(this.t<0)return;this.active=true;const p=this.t/this.duration;if(p>=1){this.dead=true;this.escaped=true;return;}
      const here=sampleArcadeRoute(this.route,p),ahead=sampleArcadeRoute(this.route,Math.min(.999,p+.008));
      this.x=here.x*W;this.y=78+here.y*500;this.flip=ahead.x-here.x<0;
    }
    draw(){
      if(!this.active||this.dead)return;
      const specialPalettes={bee:['#50f3ff','#2869e8','#fff','#ffe34e','#ff4eaa'],butterfly:['#ff4eaa','#704aff','#ffe34e','#50f3ff','#fff'],dragonfly:['#ffe34e','#ff6b3d','#fff','#50f3ff','#ff4eaa'],scorpion:['#ff784f','#ffcf4d','#fff','#a95cff','#50f3ff'],satellite:['#a95cff','#50f3ff','#fff','#ffe34e','#ff4eaa'],stingray:['#6dff9b','#1fb89b','#fff','#50f3ff','#ffe34e'],flagship:['#ff3d5d','#ffd83d','#fff','#50f3ff','#8c58ff'],enterprise:['#d9f4ff','#61a8ff','#fff','#ff4eaa','#ffe34e']};
      const colors=this.type==='boss'?(this.hp===2?['#baffc9','#39dd73','#139d50','#50f3ff','#fff']:['#d9f4ff','#50f3ff','#2874e8','#203aa8','#fff']):specialPalettes[this.type];
      drawPixelSprite(this.x,this.y,SPRITES[this.type],colors,this.type==='boss'?2.9:2.8,this.flip);
    }
  }

  class Game {
    constructor(){
      this.high=Number(localStorage.getItem('starSquadronHigh')||10000); this.difficulty=localStorage.getItem('starSquadronDifficulty')||'normal';if(!DIFFICULTIES[this.difficulty])this.difficulty='normal';this.rules=DIFFICULTIES[this.difficulty];this.autoFire=localStorage.getItem('starSquadronAutoFire')==='true';this.mode='title'; this.time=0; this.particles=[]; this.bullets=[]; this.enemyBullets=[]; this.wave=1; this.score=0; this.lives=this.rules.lives;this.nextExtraLife=20000;this.extraLifeNotice=0; this.message=''; this.messageTimer=0; this.captureAnim=null; this.rescueShip=null; this.capturedBoss=null;this.challenge=false;this.challengeEnding=false; this.resetPlayer();
    }
    setDifficulty(level){if(this.mode==='playing'||!DIFFICULTIES[level])return;this.difficulty=level;this.rules=DIFFICULTIES[level];localStorage.setItem('starSquadronDifficulty',level);difficultyButtons.forEach(b=>b.classList.toggle('active',b.dataset.difficulty===level));}
    setAutoFire(enabled){this.autoFire=enabled;localStorage.setItem('starSquadronAutoFire',String(enabled));autoFireButton.setAttribute('aria-pressed',String(enabled));autoFireButton.textContent=`AUTO-FIRE: ${enabled?'ON':'OFF'}`;sound.wake();}
    resetPlayer(inv=this.rules.spawnInv){ this.player={x:W/2,y:H-70,w:30,h:25,cool:0,inv,dead:false,dual:false}; }
    begin(){
      const previewStage=Number(new URLSearchParams(location.search).get('stage'));
      this.score=0;this.lives=this.rules.lives;this.nextExtraLife=20000;this.extraLifeNotice=0;this.wave=Number.isInteger(previewStage)&&previewStage>0?previewStage:1;this.mode='playing';this.time=0;this.particles=[];this.bullets=[];this.enemyBullets=[];this.captureAnim=null;this.rescueShip=null;this.capturedBoss=null;this.challenge=false;this.challengeEnding=false;this.resetPlayer();this.spawnStage();panel.classList.add('hidden');resetPauseButton();showMissionControls(true);sound.start();
    }
    isChallengeStage(stage){return stage>=3&&(stage-3)%4===0;}
    spawnStage(){if(this.isChallengeStage(this.wave))this.spawnChallenge();else this.spawnWave();}
    spawnWave(){
      this.challenge=false;this.challengeEnding=false;this.challengeSummary=null;
      this.enemies=[];let entryOrder=0;
      for(const row of [4,3,2,1,0])for(let col=0;col<8;col++){const type=row===0?'boss':row<3?'butterfly':'bee';this.enemies.push(new Enemy(col,row,type,entryOrder++));}
      this.diveTimer=2; this.captureTimer=this.wave===1?3.8:6.5; this.message=`STAGE ${this.wave}`; this.messageTimer=2.2;
    }
    spawnChallenge(){
      this.challenge=true;this.challengeEnding=false;this.challengeSummary=null;this.enemyBullets=[];this.bullets=[];this.captureAnim=null;this.rescueShip=null;this.capturedBoss=null;this.challengeHits=0;this.challengeGroupHits=[0,0,0,0,0];this.challengeGroupBonus=0;this.challengeRound=Math.floor((this.wave-3)/4)+1;
      this.enemies=[];for(let group=0;group<5;group++)for(let i=0;i<8;i++)this.enemies.push(new ChallengeEnemy(group,i,this.challengeRound));
      this.player.inv=0;this.message='CHALLENGING STAGE';this.messageTimer=2.4;sound.start();
    }
    challengeGroupValue(){return this.challengeRound<=2?1000:this.challengeRound<=4?1500:this.challengeRound<=6?2000:3000;}
    hitChallengeEnemy(enemy){
      enemy.hp--;sound.hit();this.explode(enemy.x,enemy.y,['#fff','#ffe34e','#50f3ff']);if(enemy.hp>0)return;
      enemy.dead=true;this.challengeHits++;this.challengeGroupHits[enemy.group]++;this.addScore(100);
      if(this.challengeGroupHits[enemy.group]===8){const bonus=this.challengeGroupValue();this.challengeGroupBonus+=bonus;this.addScore(bonus);this.message=`GROUP PERFECT +${bonus}`;this.messageTimer=1.25;sound.rescue();}
    }
    finishChallenge(){
      if(this.challengeEnding)return;this.challengeEnding=true;const perfect=this.challengeHits===40,perfectBonus=perfect?10000:0;if(perfectBonus){this.addScore(perfectBonus);sound.rescue();}
      this.challengeSummary={hits:this.challengeHits,shotBonus:this.challengeHits*100,groupBonus:this.challengeGroupBonus,perfect,perfectBonus};this.challengeEndTimer=4.8;this.bullets=[];this.message='';this.messageTimer=0;
    }
    explode(x,y,colors=['#ff4eaa','#50f3ff','#ffe34e']){ for(let i=0;i<18;i++) this.particles.push(new Particle(x,y,colors[i%colors.length])); }
    addScore(points){
      this.score+=points;let earned=false;
      while(this.score>=this.nextExtraLife){this.lives++;earned=true;this.nextExtraLife=this.nextExtraLife===20000?70000:this.nextExtraLife+70000;}
      if(earned){this.extraLifeNotice=2.5;sound.extra();}
    }
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
    destroyCaptive(boss){ const cy=boss.y+(boss.state==='dive'?-31:31);boss.carrying=false;this.capturedBoss=null;this.addScore(1000);this.explode(boss.x,cy,['#aaa','#ff4eaa','#fff']);this.message='CAPTIVE LOST';this.messageTimer=1.8;sound.boom(); }
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
      this.messageTimer-=dt;this.extraLifeNotice-=dt;this.diveTimer-=dt;this.captureTimer-=dt;this.player.cool-=dt;this.player.inv-=dt;
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
        if(hit(b,e)){b.dead=true;e.hp--;sound.hit();this.explode(b.x,b.y,['#fff','#ffe34e']);if(e.hp<=0){if(e.carrying&&e.state==='dive')this.rescue(e);else if(e.carrying)this.destroyCaptive(e);e.dead=true;this.addScore(e.type==='boss'?400:e.state==='dive'?200:100);this.explode(e.x,e.y);}}
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
      if(!this.player.dead && (this.challenge || this.player.inv<=0 || Math.floor(this.player.inv*10)%2===0)){
        if(this.player.dual){drawPixelSprite(this.player.x-11,this.player.y,SPRITES.player,['#fff','#50f3ff','#4385ff','#ff4eaa'],3);drawPixelSprite(this.player.x+11,this.player.y,SPRITES.player,['#fff','#50f3ff','#4385ff','#ff4eaa'],3);}
        else drawPixelSprite(this.player.x,this.player.y,SPRITES.player,['#fff','#50f3ff','#4385ff','#ff4eaa'],3);
      }
      if(this.messageTimer>0){ctx.globalAlpha=Math.min(1,this.messageTimer);ctx.textAlign='center';ctx.font='20px "Press Start 2P"';ctx.fillStyle='#ffe34e';ctx.fillText(this.message,W/2,H/2);ctx.globalAlpha=1;}
      if(this.extraLifeNotice>0){ctx.globalAlpha=Math.min(1,this.extraLifeNotice);ctx.textAlign='center';ctx.font='11px "Press Start 2P"';ctx.fillStyle='#ff4eaa';ctx.fillText('EXTRA FIGHTER',W/2,92);ctx.globalAlpha=1;}
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
