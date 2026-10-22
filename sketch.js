/* Character body / elastic threads / contracting binary cage.
   Fixed ml5 0.12.2 PoseNet API. All inference happens in browser.
   260 Matter bodies, fixed 120 Hz stepping, no Matter.Runner. */
const {Engine,Bodies,Body,Composite,Events}=Matter;
const COUNT=260,STEP=1000/120,ABC='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let engine,particles=[],walls=[],ripples=[],ghosts=[],links=[];
let acc=0,clockTime=0,latest=null,previousPose=null,filtered=null;
let cameraState='off',video=null,stream=null,model=null,session=0,demo=false;
let intensity=0,pressure=0,active=false,mode='idle',lastGhost=0,lastStatus='';
// In-memory history only: no camera frames or personal identifiers are stored.
const memory=Array.from({length:48},()=>0);
let routes=[],archive=[],motion={x:0,y:0,vx:0,vy:0,turn:0,spread:.5},lastCenter=null;
let familiarity=0,conflict=0,historyStrength=0,fieldAngle=0,previousActive=false,lastArchive=0;
let burstStarted=-Infinity,lastSeen=-Infinity;
let lastRaw=null,lastSampleTime=0,lean=0,openHands=.65,learnedTurn=0;
let handSequence=0,hands={left:{power:0,vx:0,vy:0,seq:0},right:{power:0,vx:0,vy:0,seq:0}};
const smooth=(value,target,dt,tau)=>value+(target-value)*(1-Math.exp(-dt/tau));
let controlsHidden=false,lastInteraction=0,cameraError='',cameraTimer=null;
let bounds={l:22,r:800,t:22,b:600},oldBounds=null,pointer=null;
const statusEl=document.getElementById('status'),cameraBtn=document.getElementById('camera'),demoBtn=document.getElementById('demo');
// COCO landmarks control forces; the artwork never draws an anatomical contour.
function setup(){
 createCanvas(windowWidth,windowHeight);pixelDensity(Math.min(window.devicePixelRatio||1,2));textFont('monospace');textAlign(CENTER,CENTER);
 engine=Engine.create({positionIterations:7,velocityIterations:5});engine.gravity.y=0;
 bounds={l:22,r:width-22,t:22,b:height-22};makeWalls();
 for(let i=0;i<COUNT;i++){
  const r=random(3.2,4.8),b=Bodies.circle(random(32,width-32),random(32,height-32),r,{density:.0018,restitution:.83,friction:.01,frictionAir:.035,label:'character'});
  Composite.add(engine.world,b);particles.push({b,r,char:ABC[i%26],next:random(300),seed:random(TWO_PI),trail:[],anchor:null});
 }
 // A sparse, bounded thread graph; no all-pairs connection loop.
 for(let i=0;i<COUNT-32;i++)links.push([i,i+32]);
 Events.on(engine,'collisionStart',e=>{
  for(const pair of e.pairs){
   const wall=pair.bodyA.label.startsWith('wall')?pair.bodyA:pair.bodyB.label.startsWith('wall')?pair.bodyB:null;
   if(!wall)continue;
   const b=wall===pair.bodyA?pair.bodyB:pair.bodyA,s=wall.label.slice(5),p=b.position;
   addRipple(s==='l'?bounds.l:s==='r'?bounds.r:constrain(p.x,bounds.l,bounds.r),s==='t'?bounds.t:s==='b'?bounds.b:constrain(p.y,bounds.t,bounds.b),s,constrain(b.speed/10,.2,1));
  }
 });
}
function makeWalls(){
 walls.forEach(w=>Composite.remove(engine.world,w));
 const specs=[['l',bounds.l-60,height/2,120,height+240],['r',bounds.r+60,height/2,120,height+240],['t',width/2,bounds.t-60,width+240,120],['b',width/2,bounds.b+60,width+240,120]];
 walls=specs.map(([s,x,y,w,h])=>Bodies.rectangle(x,y,w,h,{isStatic:true,label:'wall:'+s}));Composite.add(engine.world,walls);
}
function moveWalls(){
 Body.setPosition(walls[0],{x:bounds.l-60,y:height/2});Body.setPosition(walls[1],{x:bounds.r+60,y:height/2});
 Body.setPosition(walls[2],{x:width/2,y:bounds.t-60});Body.setPosition(walls[3],{x:width/2,y:bounds.b+60});
}
function addRipple(x,y,side,power){ripples.push({x,y,side,power,born:clockTime});if(ripples.length>48)ripples.shift();}
function demoPose(t){
 const phase=t%36,s=Math.min(width*.31,height*.65),cx=width*.5,cy=height*.47;
 const tilt=phase<7?sin(phase*1.1)*.7:phase>=19&&phase<28?.65:phase>=28?-.7:0;
 const opening=phase>=7&&phase<13?.5+.5*sin((phase-7)*1.5):.65;
 const wave=phase>=13&&phase<19?sin((phase-13)*8):0;
 const a=[[0,-.4],[-.035,-.42],[.035,-.42],[-.07,-.4],[.07,-.4],[-.15,-.22],[.15,-.22],[-.28,-.04],[.28,-.04],[-.18-opening*.45,.02+wave*.36],[.18+opening*.45,.02],[-.11,.13],[.11,.13],[-.14,.32],[.16,.32],[-.20,.53],[.23,.53]];
 for(let i=0;i<=10;i++){a[i][0]+=tilt*.28;a[i][1]+=tilt*a[i][0]*.35;}
 return a.map(([x,y])=>({x:cx+x*s,y:cy+y*s,score:1}));
}
function demoInstruction(){const p=(clockTime/1000)%36;return p<7?'倾斜转向':p<13?'双手张合':p<19?'单侧挥动':p<28?'重复方向':'转向，观察旧轨迹牵引';}
function pointerPose(t){
 const a=demoPose(t*.35),dx=mouseX-width*.5,dy=mouseY-height*.5;
 return a.map(p=>({x:p.x+dx*.65,y:p.y+dy*.5,score:1}));
}
function currentPose(){
 if(cameraState==='on'&&latest&&performance.now()-latest.time<650)return latest.points;
 if(demo)return demoPose(clockTime/1000);
 if(mouseIsPressed&&mouseY<height-110)return pointerPose(clockTime/1000);
 return null;
}
function mapCameraPose(pose){
 const vw=video.videoWidth||640,vh=video.videoHeight||480;
 // Contain mapping preserves body proportions; mirror only once.
 const scale=Math.min((width-80)/vw,(height-110)/vh),ox=(width-vw*scale)/2,oy=(height-vh*scale)/2;
 return pose.keypoints.map(k=>({x:ox+(vw-k.position.x)*scale,y:oy+k.position.y*scale,score:k.score}));
}
// Pose is reduced to aggregate motion, reach and rotation. No body contour is drawn.
function updateTracking(raw,dt){
 active=!!raw&&raw.filter(p=>p.score>.35).length>=5;
 let movement=0,n=0;
 for(const h of Object.values(hands))h.power*=Math.exp(-dt/430);
 if(active){
  const fresh=raw!==lastRaw;
  const sampleDt=lastSampleTime?Math.max(16,clockTime-lastSampleTime):33;
  const ls=raw[5],rs=raw[6],lh=raw[11],rh=raw[12];
  const shoulders=ls?.score>.4&&rs?.score>.4;
  const shoulderWidth=shoulders?Math.max(35,dist(ls.x,ls.y,rs.x,rs.y)):Math.min(width,height)*.16;
  const center=shoulders?{x:(ls.x+rs.x)/2,y:(ls.y+rs.y)/2}:{x:width/2,y:height/2};
  if(shoulders){
   const slope=(rs.y-ls.y)/(Math.abs(rs.x-ls.x)>5?rs.x-ls.x:5);
   const shift=lh?.score>.35&&rh?.score>.35?(center.x-(lh.x+rh.x)/2)/shoulderWidth:0;
   const desired=constrain(shift*1.7+slope*.9,-1,1);
   lean=smooth(lean,Math.abs(desired)<.055?0:desired,dt,150);
  }else lean=smooth(lean,0,dt,500);
  const lw=raw[9],rw=raw[10];
  if(lw?.score>.4&&rw?.score>.4){
   // Normalize by shoulder span, so standing distance does not change the gesture.
   const ratio=dist(lw.x,lw.y,rw.x,rw.y)/shoulderWidth;
   openHands=smooth(openHands,constrain((ratio-.45)/2.15,0,1),dt,140);
  }else openHands=smooth(openHands,.65,dt,1600);
  if(fresh){
   let sx=0,sy=0;
   for(let i=0;i<raw.length;i++){
    const q=raw[i],old=previousPose?.[i];
    if(q.score>.4&&old?.score>.4&&sampleDt<350){
     const vx=(q.x-old.x)/sampleDt*16.667,vy=(q.y-old.y)/sampleDt*16.667;
     movement+=Math.hypot(vx,vy);sx+=vx;sy+=vy;n++;
     if(i===9||i===10){
      const side=q.x<center.x?'left':'right',h=hands[side];
      const power=constrain((Math.hypot(vx,vy)/shoulderWidth-.012)/.105,0,1);
      if(power>.12){h.power=Math.max(h.power,power);const len=Math.max(.001,Math.hypot(vx,vy));h.vx=vx/len;h.vy=vy/len;h.seq=++handSequence;}
     }
    }
   }
   motion.vx=smooth(motion.vx,sx/Math.max(n,1),sampleDt,130);
   motion.vy=smooth(motion.vy,sy/Math.max(n,1),sampleDt,130);
   const target=constrain(movement/Math.max(n,1)/(shoulderWidth*.065),0,1);
   intensity=smooth(intensity,Math.max(target,hands.left.power*.65,hands.right.power*.65),sampleDt,150);
   previousPose=raw.map(q=>({...q}));lastRaw=raw;lastSampleTime=clockTime;
  }else intensity=smooth(intensity,Math.max(hands.left.power,hands.right.power)*.45,dt,450);
  motion.x=smooth(motion.x,(center.x-width/2)*.34,dt,180);
  motion.y=smooth(motion.y,(center.y-height*.4)*.15,dt,250);
 }else{
  filtered=null;previousPose=null;lastRaw=null;lastSampleTime=0;
  motion.vx*=Math.exp(-dt/250);motion.vy*=Math.exp(-dt/250);
  intensity=smooth(intensity,0,dt,400);lean=smooth(lean,0,dt,700);
  motion.x*=Math.exp(-dt/3000);motion.y*=Math.exp(-dt/3000);
 }
 motion.turn=lean*.95;
 motion.spread=.28+openHands*.72;
 const strongest=hands.left.power>hands.right.power?hands.left:hands.right;
 const heading=Math.abs(lean)>.14?(lean>0?0:PI):strongest.power>.25?(atan2(strongest.vy,strongest.vx)+TWO_PI)%TWO_PI:(atan2(motion.vy,motion.vx)+TWO_PI)%TWO_PI;
 const bin=Math.floor(heading/TWO_PI*memory.length)%memory.length;
 let total=memory.reduce((a,b)=>a+b,0),peak=Math.max(...memory),preferred=memory.indexOf(peak);
 historyStrength=constrain(total/38,0,1);
 familiarity=total>1?memory[bin]/Math.max(peak,.001):0;
 const angleDifference=abs(atan2(sin(heading-preferred/memory.length*TWO_PI),cos(heading-preferred/memory.length*TWO_PI)));
 conflict=lerp(conflict,active&&(intensity>.10||Math.abs(lean)>.14)?angleDifference/PI*historyStrength:0,.06);
 // Repetition earns an easier path. History decays very slowly after departure.
 const decay=Math.exp(-dt/(active?240000:110000));
 for(let i=0;i<memory.length;i++)memory[i]*=decay;
 if(active&&(intensity>.08||Math.abs(lean)>.14)){memory[bin]+=dt/1000*(.7+familiarity*1.4);memory[(bin+1)%48]+=dt/1000*.2;memory[(bin+47)%48]+=dt/1000*.2;}
 pressure=constrain(pressure+(active?(intensity*.18+conflict*.14+historyStrength*.012-.008):-.012)*dt/1000,0,1);
 const inset=22+pressure*Math.min(width,height)*.17;
 bounds={l:inset,r:width-inset,t:inset,b:height-inset};moveWalls();
 // Learn slowly, respond quickly: the old orientation remains after a turn.
 if(active)learnedTurn=smooth(learnedTurn,motion.turn,dt,9000);
 fieldAngle+=dt*.000012;
 mode=!active?'idle':conflict>.35?'conflict':pressure>.48?'confined':historyStrength>.2?'learning':'body';
 if(active&&clockTime-lastGhost>230&&intensity>.12){
  const cx=width*.5+motion.x,cy=height*.51+motion.y;
  const rx=Math.min(width*.31,height*.39),ry=rx*.67;
  const a=heading+fieldAngle;
  routes.push({x:cx+cos(a)*rx*.7,y:cy+sin(a)*ry*.7,w:.3+familiarity*.7,born:clockTime});
  if(routes.length>120)routes.shift();
 }
 if(!active)for(const r of routes)r.w*=Math.exp(-dt/90000);
 routes=routes.filter(r=>r.w>.025);
 // No persistent binary deposits: only the animated cage remains.
 if(active){
  if(!previousActive&&clockTime-lastSeen>1400)startBurst();
  lastSeen=clockTime;
 }
 previousActive=active;
}
function bodyAnchor(i){
 if(!active)return null;
 const p=particles[i],lane=i%32,rank=Math.floor(i/32);
 const elapsed=Math.max(0,clockTime-burstStarted-1800);
 // Staggered outward travelling rays: no ring, membrane or closed silhouette.
 const rate=.000075*(.75+(sin(lane*2.17)+1)*.22+intensity*.5);
 // Integrate phase; changing speed must not cause a false wrap/re-emission.
 const phase=elapsed<=0?(rank/9+lane*.019)%1:((p.integratedPhase??((rank/9+lane*.019)%1))+Math.min(deltaTime,50)*rate)%1;
 p.integratedPhase=phase;
 const cx=width*.5+motion.x,cy=height*.51+motion.y;
 const hold=historyStrength*conflict*(i%3===0?.9:.38);
 const turn=motion.turn*(1-hold)+learnedTurn*hold;
 let angle=lane/32*TWO_PI+sin(lane*7.13)*.035+fieldAngle*.14+turn;
 // Inclination visibly shears the complete field, including its principal axis.
 angle+=lean*.52*sin(angle)*sin(angle);
 const hand=cos(lane/32*TWO_PI)<0?hands.left:hands.right;
 angle+=hand.power*.28*sin(angle-atan2(hand.vy,hand.vx))*phase;
 const bend=sin(phase*2.5+lane*.73+clockTime*.00022)*.045;
 angle+=bend*phase+motion.vx*.003*phase-motion.vy*.002*sin(angle)*phase;
 // Memory bends a ray but does not collapse it into a knot or closed loop.
 let chosen=null,best=Infinity;
 for(let k=0;k<6&&routes.length;k++){
  const r=routes[(i*11+k*19)%routes.length];
  const ra=atan2(r.y-cy,r.x-cx),d=abs(atan2(sin(ra-angle),cos(ra-angle)));
  if(d<best){best=d;chosen=r;}
 }
 if(chosen){const ra=atan2(chosen.y-cy,chosen.x-cx);
  angle+=atan2(sin(ra-angle),cos(ra-angle))*historyStrength*(.18+conflict*.33)*chosen.w*phase;
 }
 const dx=cos(angle),dy=sin(angle);
 const ex=dx>0?(bounds.r-cx)/dx:(bounds.l-cx)/dx;
 const ey=dy>0?(bounds.b-cy)/dy:(bounds.t-cy)/dy;
 const reach=Math.max(30,Math.min(ex,ey)-9);
 const tension=.3+openHands*.7;
 const radius=8+Math.pow(phase,.78)*reach*tension;
 if(hand.power>.3&&p.handSeq!==hand.seq&&clockTime-burstStarted>2400){
  Body.setVelocity(p.b,{x:p.b.velocity.x*.4+hand.vx*hand.power*17,y:p.b.velocity.y*.4+hand.vy*hand.power*17});p.handSeq=hand.seq;
 }
 // Fade out at the perimeter and emit a new character near the source.
 // Re-emission is internal to the cage and never crosses its wall.
 if(elapsed>650&&p.flowPhase!==undefined&&phase<p.flowPhase-.5){
  const start=10+random(8);
  Body.setPosition(p.b,{x:cx+dx*start,y:cy+dy*start});
  Body.setVelocity(p.b,{x:dx*2,y:dy*2});p.trail=[];
 }
 p.flowPhase=phase;
 p.flowAlpha=Math.min(1,phase/.07,(1-phase)/.13);
 return{x:constrain(cx+dx*radius,bounds.l+10,bounds.r-10),y:constrain(cy+dy*radius,bounds.t+10,bounds.b-10)};
}
function startBurst(){
 burstStarted=clockTime;ghosts=[];ripples=[];
 const cx=width*.5,cy=height*.51;
 // Compact golden-angle seed: even radial distribution, no preset outline.
 for(let i=0;i<COUNT;i++){
  const p=particles[i],angle=i*2.3999632297,r=2+sqrt((i+.5)/COUNT)*Math.min(42,width*.05,height*.055);
  Body.setPosition(p.b,{x:cx+cos(angle)*r,y:cy+sin(angle)*r});
  const speed=8+(i%17)/16*11;
  Body.setVelocity(p.b,{x:cos(angle)*speed,y:sin(angle)*speed});
  p.trail=[];p.flowPhase=undefined;p.integratedPhase=undefined;p.handSeq=0;p.flowAlpha=1;p.char=ABC[i%26];
 }
}
function simulate(){
 for(let i=0;i<COUNT;i++){
  const p=particles[i],b=p.b,a=p.anchor;
  if(active&&a){
   const age=clockTime-burstStarted;
   const t=constrain((age-600)/1800,0,1),capture=t*t*(3-2*t);
   const dx=(a.x-b.position.x)*capture,dy=(a.y-b.position.y)*capture;
   const noisePower=.000025+intensity*.00015+conflict*.00007;
   Body.applyForce(b,b.position,{x:b.mass*(constrain(dx*.000038,-.006,.006)+random(-noisePower,noisePower)),y:b.mass*(constrain(dy*.000038,-.006,.006)+random(-noisePower,noisePower))});
   // Sudden movement tears the silhouette into radial bursts toward the cage.
   if(clockTime-burstStarted>2400&&intensity>.48&&random()<.018){
    const cx=width/2,cy=height/2,angle=atan2(b.position.y-cy,b.position.x-cx)+random(-.45,.45);
    Body.setVelocity(b,{x:cos(angle)*(8+intensity*11),y:sin(angle)*(8+intensity*11)});
   }
  }else{
   Body.applyForce(b,b.position,{x:b.mass*sin(clockTime*.0006+p.seed)*.000025,y:b.mass*.000035});
   if(b.position.y>bounds.b-p.r-2&&b.speed<1.5){Body.setPosition(b,{x:random(bounds.l+10,bounds.r-10),y:bounds.t+10});Body.setVelocity(b,{x:random(-.4,.4),y:.4});p.trail=[];}
  }
  if(b.speed>21)Body.setVelocity(b,{x:b.velocity.x/b.speed*21,y:b.velocity.y/b.speed*21});
 }
 Engine.update(engine,STEP);
 for(const p of particles){
  const b=p.b,x=constrain(b.position.x,bounds.l+p.r,bounds.r-p.r),y=constrain(b.position.y,bounds.t+p.r,bounds.b-p.r);
  if(x!==b.position.x||y!==b.position.y){
   let vx=b.velocity.x,vy=b.velocity.y;
   if(x!==b.position.x)vx=x===bounds.l+p.r?abs(vx)*.8:-abs(vx)*.8;
   if(y!==b.position.y)vy=y===bounds.t+p.r?abs(vy)*.8:-abs(vy)*.8;
   Body.setPosition(b,{x,y});Body.setVelocity(b,{x:vx,y:vy});
  }
 }
}
function draw(){
 const dt=Math.min(deltaTime,50);clockTime+=dt;background(0);
 updateTracking(currentPose(),dt);
 for(let i=0;i<COUNT;i++)particles[i].anchor=bodyAnchor(i);
 acc+=dt;while(acc>=STEP){simulate();acc-=STEP;}
 if(active&&clockTime-lastGhost>230&&intensity>.16){
  ghosts.push({born:clockTime,pts:particles.filter((_,i)=>i%3===0).map(p=>({x:p.b.position.x,y:p.b.position.y,char:p.char}))});
  if(ghosts.length>6)ghosts.shift();lastGhost=clockTime;
 }
 ghosts=ghosts.filter(g=>clockTime-g.born<1550);
 noStroke();textSize(9);
 for(const g of ghosts){const age=(clockTime-g.born)/1550;fill(83,169,111,(1-age)*45);for(const p of g.pts)text(p.char,lerp(p.x,constrain(p.x,bounds.l,bounds.r),age),p.y-age*8);}
 // Neighbour threads stretch, then disappear when their elastic reach is exceeded.
 if(active){strokeWeight(.6);for(const [a,b]of links){const p=particles[a].b.position,q=particles[b].b.position,d=dist(p.x,p.y,q.x,q.y);if(d<135){stroke(111,242,151,(1-d/135)*(35+intensity*70));line(p.x,p.y,q.x,q.y);}}}
 for(let i=0;i<COUNT;i++){
  const p=particles[i],b=p.b;
  if(active){p.trail.push({x:b.position.x,y:b.position.y});if(p.trail.length>9)p.trail.shift();}
  else p.trail=[];
  if(active&&b.speed>1.4){noFill();strokeWeight(.7);for(let j=1;j<p.trail.length;j++){stroke(131,255,167,j/p.trail.length*(25+intensity*80));line(p.trail[j-1].x,p.trail[j-1].y,p.trail[j].x,p.trail[j].y);}}
  if(clockTime>p.next){p.char=!active&&random()<.27?String(floor(random(2))):ABC[floor(random(26))];p.next=clockTime+random(90,350)/(1+intensity*2);}
  noStroke();fill(active?153:66,active?245:110,active?181:79,active?220*(clockTime-burstStarted<2400?1:Math.max(.08,p.flowAlpha??1)):125);textSize(p.r*2.5+(active?intensity*2:0));text(p.char,b.position.x,b.position.y);
 }
 drawMemory();drawCage();
 document.getElementById('energy').style.width=(pressure*100)+'%';
 const labels={idle:'余留 / 停止之后，过去仍在缓慢消退',body:'回应 / 倾斜转向 · 双手张合 · 单侧挥动',learning:'熟悉 / 重复的方向正在成为通道',conflict:'偏离 / 你已转向，过去仍在牵引',confined:'固化 / 你的痕迹正在编织边界'};
 const message=cameraError?cameraError:cameraState==='loading'?'正在加载 PoseNet · 可先打开动作演示':(demo?'演示 · '+demoInstruction()+' / ':'')+labels[mode];
 if(!controlsHidden&&clockTime-lastInteraction>18000){setControls(true);}
 if(message!==lastStatus){statusEl.textContent=message;lastStatus=message;}
}
function drawMemory(){
 noFill();strokeWeight(.6);
 // Historical current: faint paths persist when the visitor changes direction.
 for(let i=1;i<routes.length;i++){
  const a=routes[i-1],b=routes[i];if(dist(a.x,a.y,b.x,b.y)>100)continue;
  stroke(77,171,111,a.w*(15+historyStrength*35));line(a.x,a.y,b.x,b.y);
 }

}

function drawCage(){
 ripples=ripples.filter(r=>clockTime-r.born<850);
 // Quiet original perimeter and inward echoes make contraction readable.
 noFill();strokeWeight(.5);stroke(76,134,92,28);rect(22,22,width-44,height-44);
 if(pressure>.07){for(let i=1;i<=3;i++){const d=i*8*pressure;stroke(111,213,139,35*(1-i/4)*pressure);rect(bounds.l-d,bounds.t-d,bounds.r-bounds.l+2*d,bounds.b-bounds.t+2*d);}}
 const paint=(x,y,side,index)=>{
  let flash=0,bulge=0;
  for(const r of ripples){if(r.side!==side)continue;const age=(clockTime-r.born)/850,d=dist(x,y,r.x,r.y);flash=Math.max(flash,exp(-abs(d-age*125)/18)*(1-age)*r.power);bulge+=exp(-d*d/1600)*sin(age*PI)*r.power*12;}
  if(side==='l')x-=bulge;if(side==='r')x+=bulge;if(side==='t')y-=bulge;if(side==='b')y+=bulge;
  noStroke();fill(65+flash*190+pressure*55,125+flash*130+pressure*65,85+flash*170,65+noise(index,clockTime*.004)*85+flash*100);textSize(10+flash*3);text(noise(index*3,floor(clockTime/95))>.5?'1':'0',x,y);
 };
 for(let x=bounds.l;x<=bounds.r;x+=13){paint(x,bounds.t,'t',x);paint(x,bounds.b,'b',x+1000);}
 for(let y=bounds.t+13;y<bounds.b;y+=13){paint(bounds.l,y,'l',y+2000);paint(bounds.r,y,'r',y+3000);}
 for(const r of ripples){const age=(clockTime-r.born)/850;noFill();stroke(153,255,182,(1-age)*95*r.power);circle(r.x,r.y,4+age*125);}
}
function windowResized(){
 const ow=width,oh=height;resizeCanvas(windowWidth,windowHeight);bounds={l:22,r:width-22,t:22,b:height-22};makeWalls();
 particles.forEach(p=>{Body.setPosition(p.b,{x:constrain(p.b.position.x/ow*width,30,width-30),y:constrain(p.b.position.y/oh*height,30,height-30)});p.trail=[];});
 filtered=null;previousPose=null;latest=null;ghosts=[];ripples=[];acc=0;
}
function setDemo(value){if(value&&!demo){lastSeen=-Infinity;previousActive=false;}cameraError='';demo=value;demoBtn.setAttribute('aria-pressed',String(value));demoBtn.textContent=value?'停止演示':'动作演示';filtered=null;previousPose=null;lastRaw=null;lastSampleTime=0;}
demoBtn.onclick=()=>{if(!demo&&cameraState!=='off')stopCamera();setDemo(!demo);};
function stopCamera(){
 session++;clearTimeout(cameraTimer);cameraState='off';if(model)model.removeAllListeners('pose');model=null;
 if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;
 if(video){video.pause();video.srcObject=null;video.remove();video=null;}
 latest=null;filtered=null;previousPose=null;cameraBtn.textContent='开启摄像头';lastStatus='';
}
cameraBtn.onclick=async()=>{
 if(cameraState!=='off'){stopCamera();return;}
 if(!window.isSecureContext||!navigator.mediaDevices){cameraError='摄像头需要 HTTPS 或 localhost · 请使用动作演示';statusEl.textContent=cameraError;return;}
 cameraError='';const token=++session;cameraState='loading';cameraTimer=setTimeout(()=>{if(token===session&&cameraState==='loading'){stopCamera();cameraError='模型加载超时 · 请检查网络，或使用动作演示';}},60000);setDemo(false);cameraBtn.textContent='取消摄像头';
 try{
  const s=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'},audio:false});
  if(token!==session){s.getTracks().forEach(t=>t.stop());return;}stream=s;
  const v=document.createElement('video');video=v;v.muted=true;v.playsInline=true;v.width=640;v.height=480;v.srcObject=s;document.body.appendChild(v);await v.play();
  if(token!==session)return;
  const m=ml5.poseNet(v,{detectionType:'single',architecture:'MobileNetV1',outputStride:16,inputResolution:257,multiplier:.75,quantBytes:2,modelUrl:"model/model.json",flipHorizontal:false},()=>{if(token!==session)return;clearTimeout(cameraTimer);cameraState='on';cameraBtn.textContent='关闭摄像头';});
  model=m;m.on('pose',results=>{if(token!==session||cameraState!=='on')return;const pose=results[0]?.pose;if(pose&&pose.score>.2)latest={time:performance.now(),points:mapCameraPose(pose)};else latest=null;});
 }catch(e){if(token===session){stopCamera();setDemo(true);statusEl.textContent='摄像头不可用 · 已切换动作演示：'+e.message;cameraError='摄像头不可用 · 可使用动作演示：'+e.message;lastStatus='';}}
};
function resetArtwork(){
 lastRaw=null;previousPose=null;lastSampleTime=0;lean=0;learnedTurn=0;openHands=.65;
 motion={x:0,y:0,vx:0,vy:0,turn:0,spread:.65};
 for(const h of Object.values(hands)){h.power=0;h.seq=0;h.vx=0;h.vy=0;}
 lastSeen=-Infinity;previousActive=false;memory.fill(0);routes=[];archive=[];ghosts=[];ripples=[];historyStrength=0;pressure=0;conflict=0;intensity=0;fieldAngle=0;
 particles.forEach(p=>{p.trail=[];Body.setPosition(p.b,{x:random(32,width-32),y:random(32,height-32)});Body.setVelocity(p.b,{x:0,y:0});});
}
function setControls(hidden){controlsHidden=hidden;document.body.classList.toggle('exhibition',hidden);}
async function fullscreen(){try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch(e){cameraError='此浏览器不支持全屏 · 可使用浏览器全屏功能';}}
document.getElementById('fullscreen').onclick=fullscreen;
document.getElementById('reset').onclick=resetArtwork;
document.getElementById('hide').onclick=()=>setControls(true);
window.addEventListener('pointerdown',()=>{lastInteraction=clockTime;if(controlsHidden)setControls(false);});
window.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='h')setControls(!controlsHidden);if(e.key.toLowerCase()==='f')fullscreen();if(e.key.toLowerCase()==='r')resetArtwork();});
window.addEventListener('pagehide',stopCamera);
