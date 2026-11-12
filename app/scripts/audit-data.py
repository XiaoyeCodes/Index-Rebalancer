"""Independent, standard-library-only reference. Does not execute JavaScript.

node app/scripts/audit-export.mjs --output /tmp/browser.json
python app/scripts/audit-data.py app/data/prices-weekly.json /tmp/browser.json
"""
import json
import math
import statistics
import sys
from datetime import date, timedelta

data, browser = (json.load(open(p, encoding="utf-8")) for p in sys.argv[1:3])
origin = date.fromisoformat(data["start"])
weeks = [origin + timedelta(weeks=i) for i in range(data["n"])]
dates = [date.fromisoformat(d) for d in data.get("dates", [d.isoformat() for d in weeks])]
errors = []
max_errors = {"asset": 0, "balance": 0, "nav": 0, "metric": 0}


def compare(actual, expected, label, kind, tolerance=1e-8):
    if actual is None or expected is None:
        if actual != expected:
            errors.append(label + ": missing result")
        return
    delta = abs(actual - expected)
    max_errors[kind] = max(max_errors[kind], delta)
    if not math.isfinite(delta) or delta > tolerance:
        errors.append(f"{label}: {actual} != {expected} (difference {delta})")


def price(symbol, i):
    asset = data["assets"][symbol]
    currency = browser["catalogue"][symbol].get("cur", "USD")
    exchange = data.get("fx", {}).get(currency, [1] * data["n"])[i]
    return asset["c"][i - asset["first"]] / exchange


def pearson(x, y):
    mx, my = statistics.mean(x), statistics.mean(y)
    return sum((a-mx)*(b-my) for a,b in zip(x,y)) / math.sqrt(sum((v-mx)**2 for v in x)*sum((v-my)**2 for v in y))


def drawdown(values, initial=0):
    peak, worst = initial, 0
    for value in values:
        peak = max(peak, value)
        worst = min(worst, value/peak-1)
    return worst


def irr(flows):
    # Solve in log(1+r) space, independently of the JavaScript rate-space solver.
    if not flows or flows[0][0] == flows[-1][0]:
        return None
    t0 = flows[0][0]
    periods = [((d-t0).days/365, amount) for d,amount in flows]
    def npv(z):
        return math.fsum(amount*math.exp(-z*t) for t,amount in periods)
    lo, hi = -13.815510557964274, math.log(1000001)
    if npv(lo)*npv(hi) > 0:
        return None
    for _ in range(160):
        mid = (lo+hi)/2
        if npv(mid) > 0:
            lo = mid
        else:
            hi = mid
    return math.expm1((lo+hi)/2)


for symbol, asset in data["assets"].items():
    stat = browser["statistics"][symbol]
    begin = max(asset["first"], data["n"]-1-round(20*52.1775))
    # Legacy mode permits auditing the original screenshot before the corrections.
    legacy = "statisticsVersion" not in data
    values = asset["c"] if legacy else asset["c"][begin-asset["first"]:]
    returns = [math.log(b/a) for a,b in zip(values,values[1:])]
    years = (data["n"]-1-begin)/52.1775 if legacy else (dates[-1]-dates[begin]).days/365.25
    cagr = (asset["c"][-1]/asset["c"][begin-asset["first"]])**(1/years)-1 if years >= 1 else None
    compare(stat["cagr"], cagr, symbol+" CAGR", "asset")
    compare(stat["vol"], statistics.pstdev(returns)*math.sqrt(52.1775), symbol+" volatility", "asset")
    compare(stat["mdd"], drawdown(values), symbol+" drawdown", "asset")
    indices = range((asset["first"] if legacy else begin)+1,data["n"])
    ra = [math.log(asset["c"][i-asset["first"]]/asset["c"][i-asset["first"]-1]) if legacy else math.log(price(symbol,i)/price(symbol,i-1)) for i in indices]
    rs = [math.log(price("SPY",i)/price("SPY",i-1)) for i in indices]
    compare(stat["corr"], pearson(ra,rs), symbol+" correlation", "asset")

summaries = []
yearly_checks = monthly_weight_checks = 0
for scenario in browser["scenarios"]:
    cfg, result = scenario["cfg"], scenario["result"]
    symbols = list(cfg["weights"])
    def first_week(symbol):
        asset = data["assets"][symbol]
        boundaries = [asset["first"]]
        for key in ["actualFirst", "spliceWeek"]:
            if asset.get(key):
                boundaries.append(math.ceil((date.fromisoformat(asset[key])-origin).days/7))
        return max(boundaries)
    begin = max(next(i for i,d in enumerate(dates) if d.isoformat()[:7]>=cfg["start"]),max(map(first_week,symbols)),cfg.get("startWeek",0))
    assert begin == result["s0"], scenario["key"]+" start"
    target = [cfg["weights"][s]/sum(cfg["weights"].values()) for s in symbols]
    holdings = [0.0]*len(symbols)
    units = invested = turnover = 0
    fee = cfg["fee"]/100
    nav, balances, flows = [], [], []
    reb_count = 0
    for i in range(begin,data["n"]):
        prices = [price(s,i) for s in symbols]
        values = [p*q for p,q in zip(prices,holdings)]
        total = sum(values)
        new_month = i == begin or dates[i].month != dates[i-1].month
        addition = (cfg.get("initial",0) if i == begin else 0)+(cfg.get("monthly",0) if new_month else 0)
        if addition:
            units += addition/(total/units if units else 1)
            invested += addition
            flows.append((dates[i],-addition))
            if cfg["cashflow"]:
                gaps = [max(0,w*(total+addition)-v) for w,v in zip(target,values)]
                missing = sum(gaps)
                allocation = [addition*g/missing for g in gaps] if missing>=addition else [g+(addition-missing)*w for g,w in zip(gaps,target)]
            else:
                allocation = [addition*w for w in target]
            holdings = [q+(a*(1-fee) if "statisticsVersion" not in data else a/(1+fee))/p for q,a,p in zip(holdings,allocation,prices)]
        values = [p*q for p,q in zip(prices,holdings)]
        total = sum(values)
        weights = [v/total for v in values]
        threshold = any(abs(v-w)*100>=cfg["abs"] or abs(v-w)/w*100>=cfg["rel"] for v,w in zip(weights,target))
        calendar = new_month and i>begin and dates[i].month in ([1,4,7,10] if cfg["period"]=="Q" else [1])
        hit = (cfg["mode"] in ["threshold","hybrid"] and threshold) or (cfg["mode"] in ["calendar","hybrid"] and calendar)
        if hit:
            trades = [w*total-v for w,v in zip(target,values)]
            gross = sum(abs(t) for t in trades if abs(t)>.5)
            if gross/total>.002:
                before = total
                if "statisticsVersion" not in data:
                    total -= gross*fee
                else:
                    # Piecewise linear analytic solution, independent of JS bisection.
                    trial = total
                    for _ in range(30):
                        signs = [1 if w*trial>=v else -1 for w,v in zip(target,values)]
                        after = (before+fee*sum(sign*v for sign,v in zip(signs,values)))/(1+fee*sum(sign*w for sign,w in zip(signs,target)))
                        if abs(after-trial)<1e-9:
                            trial = after
                            break
                        trial = after
                    total = trial
                    gross = sum(abs(w*total-v) for w,v in zip(target,values))
                turnover += gross/2/before
                holdings = [w*total/p for w,p in zip(target,prices)]
                reb_count += 1
        balance = sum(q*p for q,p in zip(holdings,prices))
        balances.append(balance)
        nav.append(balance/units)
        if i==data["n"]-1 or dates[i+1].month!=dates[i].month:
            published=next(row["w"] for row in result["wHist"] if row["i"]==i)
            for symbol,q,p in zip(symbols,holdings,prices):
                compare(published[symbol],q*p/balance,scenario["key"]+" monthly weight "+symbol+" "+str(i),"metric")
                monthly_weight_checks+=1
    flows.append((dates[-1],balances[-1]))
    years = (data["n"]-1-begin)/52.1775 if "statisticsVersion" not in data else (dates[-1]-dates[begin]).days/365.25
    reference = {"final":balances[-1],"invested":invested,"mdd":drawdown(nav,1),"xirr":irr(flows),"twr":nav[-1]**(1/years)-1,"vol":statistics.pstdev([math.log(b/a) for a,b in zip(nav,nav[1:])])*math.sqrt(52.1775),"turnYear":turnover/years,"rebCount":reb_count}
    annual={}
    previous=None
    for day,value in zip(dates[begin:],nav):
        year=str(day.year)
        if year not in annual:
            annual[year]={"s":previous if previous is not None else (nav[0] if "statisticsVersion" not in data else 1)}
        annual[year]["e"]=value
        previous=value
    for year,values in annual.items():
        for key,value in values.items():
            compare(result["years"][year][key],value,scenario["key"]+" annual "+year+key,"metric")
            yearly_checks+=1
    for key,value in reference.items():
        compare(result[key],value,scenario["key"]+" "+key,"balance" if key in ["final","invested"] else "metric",1e-6 if key in ["final","invested"] else 1e-8)
    for j,(balance,value) in enumerate(zip(balances,nav)):
        compare(result["val"][j][1],balance,scenario["key"]+" balance "+str(j),"balance",1e-6)
        compare(result["nav"][j]["c"],value,scenario["key"]+" NAV "+str(j),"nav")
    summaries.append({"key":scenario["key"],"name":scenario.get("name"),"start":dates[begin].isoformat(),"contributions":len(flows)-1,**reference})

report = {"asOf":data["asOf"],"assets":len(data["assets"]),"backtests":len(summaries),"weeklyBalances":sum(len(s["result"]["val"]) for s in browser["scenarios"]),"yearlyChecks":yearly_checks,"monthlyWeightChecks":monthly_weight_checks,"maxAbsoluteErrors":max_errors,"failures":errors,"models":summaries}
if len(sys.argv)>3:
    with open(sys.argv[3],"w",encoding="utf-8") as output:
        json.dump(report,output,ensure_ascii=False,indent=2)
print(json.dumps({k:v for k,v in report.items() if k!="models"},ensure_ascii=False,indent=2))
sys.exit(bool(errors))
