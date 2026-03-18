import json, numpy as np
from collections import Counter, defaultdict
from datetime import datetime, timezone

def generate_showcase(n_sessions=10000, seed=42):
    rng = np.random.RandomState(seed)
    
    # === FUNNEL STAGES (strict order) ===
    # Each session progresses through stages. At each stage, user either
    # advances to next stage or exits. No going back.
    # Stage 0: Entry (homepage/landing/search/category)
    # Stage 1: Browse (view)  
    # Stage 2: Intent (add_to_cart)
    # Stage 3: Commit (checkout)
    # Stage 4: Convert (purchase)
    
    ENTRY_DIST = {'homepage': 0.45, 'landing': 0.10, 'search': 0.25, 'category': 0.20}
    
    # P(advance to next stage | reached this stage)
    # These create a realistic funnel shape
    ADVANCE_RATES = {
        'homepage':     0.75,  # 75% go to browse
        'landing':      0.38,  # 38% — high friction point (deliberate)
        'search':       0.72,  # 72% find something to view
        'category':     0.70,  # 70% find something to view
        'view':         0.18,  # 18% add to cart
        'add_to_cart':  0.58,  # 58% proceed to checkout
        'checkout':     0.45,  # 45% complete purchase — deliberate friction point
    }
    
    # Some entry users skip browse and go directly to cart (returning customers)
    SKIP_TO_CART = 0.02  # 2% of sessions
    
    sessions = []
    for i in range(n_sessions):
        # Pick entry point
        entry = rng.choice(list(ENTRY_DIST.keys()), p=list(ENTRY_DIST.values()))
        path = [entry]
        
        # Skip-to-cart (returning customer, knows what they want)
        if rng.random() < SKIP_TO_CART:
            path.extend(['add_to_cart', 'checkout', 'purchase'] if rng.random() < 0.4 
                        else ['add_to_cart', 'checkout'] if rng.random() < 0.5
                        else ['add_to_cart'])
        else:
            # Normal funnel progression
            # Entry → View?
            if rng.random() < ADVANCE_RATES[entry]:
                path.append('view')
                
                # View → Add to cart?
                if rng.random() < ADVANCE_RATES['view']:
                    path.append('add_to_cart')
                    
                    # Add to cart → Checkout?
                    if rng.random() < ADVANCE_RATES['add_to_cart']:
                        path.append('checkout')
                        
                        # Checkout → Purchase?
                        if rng.random() < ADVANCE_RATES['checkout']:
                            path.append('purchase')
        
        converted = 'purchase' in path
        value = round(rng.uniform(30, 250), 2) if converted else 0
        sessions.append({
            'id': f's{i}', 'path': path, 'converted': converted,
            'n_events': len(path), 'value': value
        })
    
    n_conv = sum(1 for s in sessions if s['converted'])
    cr = n_conv / n_sessions
    avg_ev = np.mean([s['n_events'] for s in sessions])
    avg_val = np.mean([s['value'] for s in sessions if s['converted']]) if n_conv > 0 else 0
    
    print(f"Sessions: {n_sessions}")
    print(f"Converting: {n_conv} ({cr:.1%})")
    print(f"Avg path: {avg_ev:.1f} steps")
    print(f"Avg order value: €{avg_val:.0f}")
    
    # === FUNNEL COUNTS (for validation) ===
    stage_reached = defaultdict(int)
    for s in sessions:
        for step in s['path']:
            stage_reached[step] += 1  # each session counts each stage once (no repeats by construction)
    
    print(f"\nFunnel:")
    for step in ['homepage','landing','search','category','view','add_to_cart','checkout','purchase']:
        if step in stage_reached:
            print(f"  {step}: {stage_reached[step]:,}")
    
    total_entry = sum(stage_reached[e] for e in ENTRY_DIST)
    print(f"  Total entry: {total_entry:,} (should be {n_sessions:,})")
    print(f"  View: {stage_reached['view']:,} (should be < {total_entry:,}) ✓" if stage_reached['view'] < total_entry else "  View > Entry ✗")
    
    # === SANKEY DATA ===
    STAGE_ORDER = {'homepage':0,'landing':0,'search':0,'category':0,'view':1,'add_to_cart':2,'checkout':3,'purchase':4}
    ZONE = {'homepage':'navigation','landing':'navigation','search':'navigation','category':'navigation',
            'view':'engagement','add_to_cart':'commitment','checkout':'commitment','purchase':'commitment'}
    
    # Count transitions (each session contributes at most 1 per link)
    link_counts = defaultdict(int)
    all_steps = set()
    for s in sessions:
        for j in range(len(s['path']) - 1):
            link_counts[(s['path'][j], s['path'][j+1])] += 1
        for step in s['path']:
            all_steps.add(step)
    
    sorted_steps = sorted(all_steps, key=lambda s: (STAGE_ORDER.get(s, 99), s))
    nid = {n: i for i, n in enumerate(sorted_steps)}
    nodes = [{'id': nid[n], 'name': n} for n in sorted_steps]
    
    # === FRICTION SCORING ===
    # Exit rate = sessions that stop at this step / sessions that reach this step
    step_exits = defaultdict(int)
    for s in sessions:
        last = s['path'][-1]
        if last != 'purchase':
            step_exits[last] += 1
    
    zone_dropoffs = defaultdict(list)
    for step in sorted_steps:
        if step == 'purchase': continue
        total = stage_reached[step]
        exits = step_exits.get(step, 0)
        drop = exits / total if total > 0 else 0
        zone_dropoffs[ZONE[step]].append(drop)
    
    zone_baselines = {z: np.mean(d) for z, d in zone_dropoffs.items()}
    zone_stds = {z: max(np.std(d), 0.03) for z, d in zone_dropoffs.items()}
    
    friction_scores = []
    for step in sorted_steps:
        if step == 'purchase': continue
        total = stage_reached[step]
        exits = step_exits.get(step, 0)
        drop = exits / total if total > 0 else 0
        zone = ZONE[step]
        bl = zone_baselines[zone]
        sd = zone_stds[zone]
        z = (drop - bl) / sd if sd > 0 else 0
        level = 'high' if z > 1.2 else ('medium' if z > 0.5 else 'normal')
        friction_scores.append({
            'step': step, 'drop_off': round(drop, 4), 'zone': zone,
            'zone_baseline': round(bl, 4), 'z_score': round(z, 2),
            'friction_level': level, 'sessions_at_step': total, 'sessions_exiting': exits
        })
    friction_scores.sort(key=lambda x: -x['z_score'])
    
    nf = sum(1 for f in friction_scores if f['friction_level'] != 'normal')
    print(f"\nFriction points: {nf}")
    for f in friction_scores:
        if f['friction_level'] != 'normal':
            print(f"  {f['step']}: {f['drop_off']:.0%} exit ({f['friction_level']}, z={f['z_score']})")
    
    # Links with friction level
    links = []
    for (src, tgt), cnt in sorted(link_counts.items(), key=lambda x: -x[1]):
        sz = ZONE[src]
        sd_val = step_exits.get(src, 0) / stage_reached[src] if stage_reached[src] > 0 else 0
        z = (sd_val - zone_baselines.get(sz, 0)) / zone_stds.get(sz, 0.1)
        lv = 'high' if z > 1.2 else ('medium' if z > 0.5 else 'normal')
        links.append({
            'source': nid[src], 'target': nid[tgt], 'value': cnt,
            'drop_off_rate': round(sd_val, 4), 'anomaly_score': round(z, 2),
            'zone': sz, 'friction_level': lv
        })
    
    # === FRICTION PATTERNS ===
    pdefs = [
        ('single_page_exit', 'User views only one page and leaves — content or relevance mismatch',
         lambda p: len(p) == 1),
        ('browse_no_cart', 'User browses products but never adds to cart — engaged but no purchase intent',
         lambda p: 'view' in p and 'add_to_cart' not in p),
        ('checkout_abandonment', 'User reaches checkout but does not purchase — payment or shipping friction',
         lambda p: 'checkout' in p and 'purchase' not in p),
        ('cart_abandonment', 'User adds to cart but never reaches checkout — hesitation or distraction',
         lambda p: 'add_to_cart' in p and 'checkout' not in p),
        ('landing_bounce', 'User arrives at landing page and leaves immediately — poor relevance or load time',
         lambda p: p == ['landing']),
    ]
    
    pats = []
    for pt, desc, det in pdefs:
        m = [s for s in sessions if det(s['path'])]
        if m:
            nc = sum(1 for s in m if s['converted'])
            pats.append({
                'type': pt, 'description': desc,
                'sessions_affected': len(m), 'pct_of_total': round(len(m)/n_sessions, 4),
                'conversion_rate': round(nc/len(m), 4)
            })
    pats.sort(key=lambda x: -x['sessions_affected'])
    
    print(f"\nPatterns:")
    for p in pats:
        print(f"  {p['type']}: {p['sessions_affected']} ({p['pct_of_total']:.0%}), CR={p['conversion_rate']:.1%}")
    
    # === PATH MINING ===
    def mine(sl, ms=10):
        pc = Counter(' → '.join(s['path']) for s in sl if len(s['path']) >= 2)
        res = []
        for ps, cnt in pc.most_common(30):
            if cnt < ms: break
            pl = ps.split(' → ')
            nc = sum(1 for s in sl if s['path'] == pl and s['converted'])
            res.append({
                'path': pl, 'path_string': ps, 'count': cnt,
                'support': round(cnt/len(sl), 4),
                'conversion_rate': round(nc/cnt, 4) if cnt > 0 else 0,
                'avg_events': len(pl)
            })
        return res
    
    ap = mine(sessions)
    cp = mine([s for s in sessions if s['converted']])
    np_ = mine([s for s in sessions if not s['converted']])
    cps = {p['path_string'] for p in cp}
    nps = {p['path_string'] for p in np_}
    
    print(f"\nPatterns mined: {len(ap)} all, {len(cp)} converting, {len(np_)} non-converting")
    
    # === TRANSITION MATRIX ===
    def compute_matrix(sl):
        c = defaultdict(lambda: defaultdict(int))
        for s in sl:
            for j in range(len(s['path'])-1):
                c[s['path'][j]][s['path'][j+1]] += 1
        return {f: {t: round(n/sum(ts.values()), 4) for t, n in ts.items()} for f, ts in c.items()}
    
    # === ASSEMBLE ===
    return {
        'metadata': {
            'total_sessions': n_sessions, 'converting_sessions': n_conv,
            'conversion_rate': round(cr, 4),
            'avg_events_per_session': round(avg_ev, 1),
            'avg_session_value': round(avg_val, 2),
            'data_source': 'synthetic_showcase',
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'n_friction_points': nf,
            'top_friction_step': friction_scores[0]['step'] if friction_scores else None
        },
        'sankey': {'nodes': nodes, 'links': links},
        'patterns': {
            'all': ap, 'converting': cp, 'non_converting': np_,
            'unique_to_converting': [p for p in cp if p['path_string'] not in nps],
            'unique_to_non_converting': [p for p in np_ if p['path_string'] not in cps]
        },
        'friction': {'scores': friction_scores, 'patterns_detected': pats},
        'transition_matrix': {
            'all': compute_matrix(sessions),
            'converting': compute_matrix([s for s in sessions if s['converted']]),
            'non_converting': compute_matrix([s for s in sessions if not s['converted']])
        }
    }

if __name__ == '__main__':
    d = generate_showcase()
    with open('showcase_data.json', 'w') as f:
        json.dump(d, f, indent=2)
    import os
    print(f"\nExported showcase_data.json ({os.path.getsize('showcase_data.json')/1024:.1f} KB)")
