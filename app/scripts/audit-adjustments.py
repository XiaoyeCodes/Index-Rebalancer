"""Reconstruct dividend adjustment factors from unadjusted closes and cash events.
This verifies internal consistency of Yahoo fields, not independent event coverage.
Capital-gain distributions in mutual-fund proxies are reported separately.
"""
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

directory=Path(sys.argv[1] if len(sys.argv)>1 else "app/data/raw")
results=[]
for file in directory.glob("*.json"):
    raw=json.load(open(file,encoding="utf-8"))["chart"]["result"][0]
    prices=raw["indicators"]["quote"][0]["close"]
    adjusted=raw["indicators"]["adjclose"][0]["adjclose"]
    valid=[(t,p,a) for t,p,a in zip(raw["timestamp"],prices,adjusted) if p and a and p>0 and a>0]
    utcday=lambda stamp:datetime.fromtimestamp(stamp,timezone.utc).date().isoformat()
    events={utcday(e["date"]):e["amount"] for e in raw.get("events",{}).get("dividends",{}).values()}
    factor=valid[-1][2]/valid[-1][1]
    worst=0
    for previous,current in reversed(list(zip(valid,valid[1:]))):
        dividend=events.get(utcday(current[0]),0)
        factor*=1-dividend/previous[1]
        error=abs((previous[2]/previous[1])/factor-1)
        worst=max(worst,error)
    results.append({"ticker":raw["meta"]["symbol"],"type":raw["meta"]["instrumentType"],"rows":len(valid),"dividendEvents":len(events),"maxRelativeFactorDifference":worst})
report={"tickers":len(results),"dailyRows":sum(r["rows"] for r in results),"results":results}
if len(sys.argv)>2:
    Path(sys.argv[2]).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(any(r["maxRelativeFactorDifference"]>1e-5 for r in results))
