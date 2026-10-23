/**
 * js/utils.js — helpers: shuffle, seededRng, delay, vibrate, confetti, escHtml
 * 100% offline — sin imágenes externas
 */

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function shuffle(arr) {
  var a=arr.slice();
  for (var i=a.length-1;i>0;i--) { var j=Math.floor(Math.random()*(i+1)); var t=a[i];a[i]=a[j];a[j]=t; }
  return a;
}

/* Park-Miller LCG — determinista con semilla */
function seededRng(seed) {
  var s=seed%2147483647; if(s<=0) s+=2147483646;
  return function(){ s=(s*16807)%2147483647; return (s-1)/2147483646; };
}

function seededShuffle(arr, rng) {
  var a=arr.slice();
  for (var i=a.length-1;i>0;i--) { var j=Math.floor(rng()*(i+1)); var t=a[i];a[i]=a[j];a[j]=t; }
  return a;
}

function delay(ms) { return new Promise(function(r){ setTimeout(r,ms); }); }

function vibrateDevice(pattern, enabled) {
  if (!enabled) return;
  try {
    /* Capacitor nativo — mejor sensación en Android/iOS */
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
      var H = window.Capacitor.Plugins.Haptics;
      var isError = pattern && pattern.length > 1; /* patrón largo = error */
      if (isError) { H.notification({ type: 'ERROR' }).catch(function(){}); }
      else         { H.impact({ style: 'MEDIUM' }).catch(function(){}); }
      return;
    }
    /* Fallback web */
    if ('vibrate' in navigator) navigator.vibrate(pattern);
  } catch(e) {}
}
function supportsVibration() {
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) return true;
  return 'vibrate' in navigator;
}

function addTempClass(el, cls, dur) {
  if (!el) return; dur=dur||600;
  el.classList.add(cls);
  setTimeout(function(){ el.classList.remove(cls); }, dur);
}

/** Nombre del país según idioma activo */
function cn(country) {
  var lang = getLang ? getLang() : 'en';
  if (country.names) return country.names[lang] || country.names.en || country.names.es || country.code;
  return country.name || country.code;
}

/** Capital del país según idioma activo */
function cap(country) {
  var lang = getLang ? getLang() : 'en';
  if (country.capitals) return country.capitals[lang] || country.capitals.en || country.capitals.es || '?';
  return '?';
}

function launchConfetti(canvas) {
  if (!canvas) return;
  var ctx=canvas.getContext('2d');
  canvas.width=window.innerWidth; canvas.height=window.innerHeight;
  var COLORS=['#ffd040','#ff9f00','#ff5e62','#7c3aed','#22c55e','#38bdf8','#f472b6'];
  var pieces=[];
  for (var k=0;k<130;k++) {
    pieces.push({x:Math.random()*canvas.width,y:-20-Math.random()*canvas.height*.5,
      r:4+Math.random()*7,color:COLORS[Math.floor(Math.random()*COLORS.length)],
      tilt:0,ta:0,tai:0.07+Math.random()*.06,vy:2+Math.random()*3,vx:Math.random()*2-1});
  }
  var fid=null,elapsed=0;
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for (var i=0;i<pieces.length;i++){
      var p=pieces[i];
      ctx.beginPath();ctx.lineWidth=p.r/2;ctx.strokeStyle=p.color;
      ctx.moveTo(p.x+p.tilt+p.r/3,p.y);ctx.lineTo(p.x+p.tilt,p.y+p.tilt+p.r*2);ctx.stroke();
      p.ta+=p.tai;p.y+=p.vy;p.x+=p.vx;p.tilt=Math.sin(p.ta)*12;
    }
    if (++elapsed<210) fid=requestAnimationFrame(draw);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  if (fid) cancelAnimationFrame(fid);
  draw();
}
