import json, sys, itertools, collections, os
D=os.path.dirname(os.path.abspath(__file__))+"/results"
def norm(l):
    # a new:<theme> label is a "new" decision; theme wording is mechanical, compare decision class
    return "new" if l.startswith("new:") else l
def load(arm):
    out=[]
    for i in (1,2,3):
        p=f"{D}/{arm}{i}.json"
        if os.path.exists(p): out.append(json.load(open(p)))
    return out
print(f"{'arm':4} {'runs':4} {'exact-label agreement':22} {'decision agreement':20} {'matches to ag-NNN (mean)':24} drops")
for arm in "ABCD":
    runs=load(arm)
    if len(runs)<2:
        print(f"{arm:4} {len(runs):4} insufficient runs"); continue
    idx=sorted(runs[0].keys(), key=int)
    # pairwise agreement across runs, per the 5-run precedent
    ex=[]; de=[]
    for a,b in itertools.combinations(runs,2):
        ex.append(sum(1 for k in idx if a[k]==b[k])/len(idx))
        de.append(sum(1 for k in idx if norm(a[k])==norm(b[k]))/len(idx))
    nmatch=[sum(1 for k in idx if r[k].startswith("ag-"))for r in runs]
    ndrop=[sum(1 for k in idx if r[k]=="drop") for r in runs]
    print(f"{arm:4} {len(runs):4} {sum(ex)/len(ex):<22.3f} {sum(de)/len(de):<20.3f} {sum(nmatch)/len(nmatch):<24.1f} {sum(ndrop)/len(ndrop):.1f}")
print()
print("per-cluster instability (labels differing across runs within an arm):")
for arm in "ABCD":
    runs=load(arm)
    if len(runs)<2: continue
    idx=sorted(runs[0].keys(), key=int)
    unstable=[k for k in idx if len({r[k] for r in runs})>1]
    print(f"  {arm}: {len(unstable)}/{len(idx)} unstable -> {unstable}")
