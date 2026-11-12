// Regular NYSE sessions, including the New Year Saturday exception.
// Source: https://www.nyse.com/trade/hours-calendars . Extraordinary closures
// cannot be predicted; update the exceptions when an exchange announces one.
const MarketCalendar = (() => {
  const day = 86400000, iso = d => new Date(d).toISOString().slice(0,10);
  const nth = (y,m,w,n) => {const d=new Date(Date.UTC(y,m-1,1));return iso(+d+(((w-d.getUTCDay()+7)%7)+7*(n-1))*day);};
  const observed = (y,m,d) => {const t=Date.UTC(y,m-1,d),w=new Date(t).getUTCDay();return iso(t+(w===6?-1:w===0?1:0)*day);};
  function holidays(y) {
    const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
    const easter=Date.UTC(y,Math.floor((h+l-7*m+114)/31)-1,(h+l-7*m+114)%31+1);
    const memorial=new Date(Date.UTC(y,4,31));
    const dates=[nth(y,1,1,3),nth(y,2,1,3),iso(easter-2*day),iso(+memorial-((memorial.getUTCDay()+6)%7)*day),observed(y,7,4),nth(y,9,1,1),nth(y,11,4,4),observed(y,12,25)];
    if(new Date(Date.UTC(y,0,1)).getUTCDay()!==6) dates.push(observed(y,1,1));
    if(y>=2022) dates.push(observed(y,6,19));
    if(y===2025) dates.push('2025-01-09');
    return new Set(dates);
  }
  function session(date) {const d=new Date(date+'T00:00:00Z');return ![0,6].includes(d.getUTCDay())&&!holidays(d.getUTCFullYear()).has(date);}
  function expectedUSDate(now=Date.now()) {
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
    let stamp=Date.parse(`${parts.year}-${parts.month}-${parts.day}`);
    // Allow 90 minutes after the regular close for end-of-day feed publication.
    if(+parts.hour*60 + +parts.minute < 17*60+30) stamp-=day;
    while(!session(iso(stamp))) stamp-=day;
    return iso(stamp);
  }
  function expectedFXDate(now=Date.now()) {
    const today=Date.parse(iso(now));
    if(new Date(today).getUTCDay()===5&&now>=today+22.5*3600000)return iso(today);
    let last=today-day;
    if(now<last+day+3600000&&new Date(last).getUTCDay()!==5)last-=day;
    while([0,6].includes(new Date(last).getUTCDay()))last-=day;
    return iso(last);
  }
  return {session,expectedUSDate,expectedFXDate};
})();
if(typeof module==='object' && module.exports) module.exports=MarketCalendar;
