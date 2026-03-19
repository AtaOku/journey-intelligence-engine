"""
Generate showcase_data.json for Journey Intelligence Engine.

Template-based session generator with loops, backtracks, and deliberate friction.
Distributions calibrated against Baymard Institute + Contentsquare 2024 benchmarks.

Usage:
  python generate_showcase.py
  python generate_showcase.py --output showcase.json --sessions 20000
"""

import json, numpy as np, argparse, os
from collections import Counter, defaultdict
from datetime import datetime, timezone

TEMPLATES = [
    # ── CONVERTING (~3% target CR) ──
    {'path': ['homepage', 'category', 'view', 'add_to_cart', 'checkout', 'purchase'],
     'weight': 0.012, 'converts': True},
    {'path': ['homepage', 'category', 'view', 'view', 'add_to_cart', 'checkout', 'purchase'],
     'weight': 0.008, 'converts': True},
    {'path': ['homepage', 'search', 'view', 'add_to_cart', 'checkout', 'purchase'],
     'weight': 0.006, 'converts': True},
    {'path': ['homepage', 'search', 'view', 'size_guide', 'add_to_cart', 'checkout', 'purchase'],
     'weight': 0.003, 'converts': True},
    {'path': ['homepage', 'category', 'view', 'review', 'add_to_cart', 'checkout', 'purchase'],
     'weight': 0.002, 'converts': True},
    {'path': ['search', 'view', 'size_guide', 'add_to_cart', 'checkout', 'purchase'],
     'weight': 0.001, 'converts': True},

    # ── HEALTHY NON-CONVERTING ──
    {'path': ['homepage', 'category', 'view'], 'weight': 0.15, 'converts': False},
    {'path': ['homepage', 'category', 'view', 'view'], 'weight': 0.10, 'converts': False},
    {'path': ['homepage'], 'weight': 0.05, 'converts': False},
    {'path': ['landing'], 'weight': 0.065, 'converts': False},  # high landing exit = friction demo
    {'path': ['search', 'view'], 'weight': 0.05, 'converts': False},

    # ── FRICTION: Search frustration (3+ searches) ──
    {'path': ['homepage', 'search', 'view', 'search', 'view', 'search'],
     'weight': 0.07, 'converts': False},
    {'path': ['search', 'view', 'search', 'view', 'search', 'view'],
     'weight': 0.04, 'converts': False},

    # ── FRICTION: Cart hesitation (add_to_cart → view) ──
    {'path': ['homepage', 'category', 'view', 'add_to_cart', 'view', 'add_to_cart'],
     'weight': 0.05, 'converts': False},
    {'path': ['search', 'view', 'add_to_cart', 'view'],
     'weight': 0.03, 'converts': False},

    # ── FRICTION: Bounce-back browse (view→category→view, 2+ times) ──
    {'path': ['homepage', 'category', 'view', 'category', 'view', 'category', 'view'],
     'weight': 0.06, 'converts': False},
    {'path': ['category', 'view', 'category', 'view'],
     'weight': 0.04, 'converts': False},

    # ── FRICTION: Checkout abandonment ──
    {'path': ['homepage', 'category', 'view', 'add_to_cart', 'checkout'],
     'weight': 0.05, 'converts': False},
    {'path': ['search', 'view', 'add_to_cart', 'checkout'],
     'weight': 0.025, 'converts': False},

    # ── FRICTION: Deep browse no action (5+ steps, no cart) ──
    {'path': ['homepage', 'category', 'view', 'view', 'view', 'view', 'view'],
     'weight': 0.04, 'converts': False},
    {'path': ['homepage', 'category', 'view', 'category', 'view', 'view', 'review'],
     'weight': 0.03, 'converts': False},

    # ── FRICTION: Single page exit ──
    {'path': ['category'], 'weight': 0.03, 'converts': False},
    {'path': ['search'], 'weight': 0.02, 'converts': False},
    {'path': ['view'], 'weight': 0.02, 'converts': False},
]

ZONE_MAP = {
    'homepage': 'navigation', 'landing': 'navigation', 'search': 'navigation',
    'category': 'navigation', 'view': 'engagement', 'review': 'engagement',
    'size_guide': 'engagement', 'wishlist': 'engagement', 'compare': 'engagement',
    'add_to_cart': 'commitment', 'cart': 'commitment', 'checkout': 'commitment',
    'payment': 'commitment', 'purchase': 'commitment',
}

STAGE_ORDER = {
    'homepage': 0, 'landing': 0, 'search': 0, 'category': 0,
    'view': 1, 'review': 1, 'size_guide': 1, 'wishlist': 1,
    'add_to_cart': 2, 'checkout': 3, 'purchase': 4,
}

FRICTION_DETECTORS = [
    ('search_frustration_loop',
     "User searches 3+ times in a session — likely can't find what they want",
     lambda p: p.count('search') >= 3),
    ('cart_hesitation',
     'User adds to cart but returns to viewing — price or size uncertainty',
     lambda p: 'add_to_cart' in p and any(
         p[i] == 'add_to_cart' and i + 1 < len(p) and p[i + 1] == 'view'
         for i in range(len(p)))),
    ('bounce_back_browse',
     'User goes category → product → category → product — browsing without conviction',
     lambda p: sum(1 for i in range(len(p) - 1)
                   if p[i] == 'view' and p[i + 1] == 'category') >= 2),
    ('checkout_abandonment',
     'User reaches checkout but does not purchase — payment or shipping friction',
     lambda p: 'checkout' in p and 'purchase' not in p),
    ('single_page_exit',
     'User views only one page and leaves — content or relevance mismatch',
     lambda p: len(p) == 1),
    ('deep_browse_no_action',
     'User views 5+ pages but never adds to cart — engaged but no intent signal',
     lambda p: len(p) >= 5 and 'add_to_cart' not in p),
]


def generate_showcase(n_sessions=10000, seed=42):
    rng = np.random.RandomState(seed)
    total_w = sum(t['weight'] for t in TEMPLATES)
    probs = [t['weight'] / total_w for t in TEMPLATES]
    indices = rng.choice(len(TEMPLATES), size=n_sessions, p=probs)

    sessions = []
    for i, idx in enumerate(indices):
        t = TEMPLATES[idx]
        converted = t['converts']
        sessions.append({
            'id': f's{i}', 'path': list(t['path']), 'converted': converted,
            'n_events': len(t['path']),
            'value': round(rng.uniform(35, 280), 2) if converted else 0,
        })

    n_conv = sum(1 for s in sessions if s['converted'])
    cr = n_conv / n_sessions
    avg_ev = float(np.mean([s['n_events'] for s in sessions]))
    conv_vals = [s['value'] for s in sessions if s['converted']]
    avg_val = float(np.mean(conv_vals)) if conv_vals else 0

    print(f"Sessions: {n_sessions} | Converting: {n_conv} ({cr:.1%}) | Avg path: {avg_ev:.1f} steps | AOV: €{avg_val:.0f}")

    # Step counts
    step_count = defaultdict(int)
    for s in sessions:
        for step in s['path']:
            step_count[step] += 1

    # Sankey
    link_counts = defaultdict(int)
    all_steps = set()
    for s in sessions:
        for j in range(len(s['path']) - 1):
            link_counts[(s['path'][j], s['path'][j + 1])] += 1
        all_steps.update(s['path'])

    sorted_steps = sorted(all_steps, key=lambda x: (STAGE_ORDER.get(x, 99), x))
    nid = {n: i for i, n in enumerate(sorted_steps)}
    nodes = [{'id': nid[n], 'name': n} for n in sorted_steps]

    # Friction scoring (sample variance, data-derived min std)
    step_exits = defaultdict(int)
    for s in sessions:
        last = s['path'][-1]
        if last != 'purchase':
            step_exits[last] += 1

    zone_drops = defaultdict(list)
    for step in sorted_steps:
        if step == 'purchase':
            continue
        total = step_count[step]
        drop = step_exits.get(step, 0) / total if total > 0 else 0
        zone_drops[ZONE_MAP.get(step, 'unknown')].append(drop)

    all_drops = [d for ds in zone_drops.values() for d in ds]
    global_std = float(np.std(all_drops, ddof=1)) if len(all_drops) > 1 else 0.1
    min_std = global_std * 0.25

    zone_bl = {z: float(np.mean(d)) for z, d in zone_drops.items()}
    zone_sd = {z: max(float(np.std(d, ddof=1)), min_std) if len(d) > 1 else min_std
               for z, d in zone_drops.items()}

    friction_scores = []
    for step in sorted_steps:
        if step == 'purchase':
            continue
        total = step_count[step]
        exits = step_exits.get(step, 0)
        drop = exits / total if total > 0 else 0
        zone = ZONE_MAP.get(step, 'unknown')
        bl = zone_bl.get(zone, 0)
        sd = zone_sd.get(zone, min_std)
        z = (drop - bl) / sd if sd > 0 else 0
        level = 'high' if z > 2.0 else ('medium' if z > 1.5 else 'normal')
        # Absolute-ratio fallback: if drop-off is 2x+ the zone baseline,
        # flag at least medium even if z-score doesn't reach threshold
        # (small-n zones produce wide std that suppresses z-scores)
        if level == 'normal' and bl > 0 and drop / bl >= 2.5:
            level = 'medium'
        friction_scores.append({
            'step': step, 'drop_off': round(drop, 4), 'zone': zone,
            'zone_baseline': round(bl, 4), 'z_score': round(z, 2),
            'friction_level': level, 'sessions_at_step': total, 'sessions_exiting': exits,
        })
    friction_scores.sort(key=lambda x: -x['z_score'])

    nf = sum(1 for f in friction_scores if f['friction_level'] != 'normal')
    print(f"Friction points: {nf}")
    for f in friction_scores:
        if f['friction_level'] != 'normal':
            print(f"  {f['step']}: {f['drop_off']:.0%} exit ({f['friction_level']}, z={f['z_score']})")

    # Links
    links = []
    for (src, tgt), cnt in sorted(link_counts.items(), key=lambda x: -x[1]):
        sz = ZONE_MAP.get(src, 'unknown')
        sd_val = step_exits.get(src, 0) / step_count[src] if step_count[src] > 0 else 0
        bl = zone_bl.get(sz, 0)
        sd = zone_sd.get(sz, min_std)
        z = (sd_val - bl) / sd if sd > 0 else 0
        lv = 'high' if z > 2.0 else ('medium' if z > 1.5 else 'normal')
        links.append({
            'source': nid[src], 'target': nid[tgt], 'value': cnt,
            'drop_off_rate': round(sd_val, 4), 'anomaly_score': round(z, 2),
            'zone': sz, 'friction_level': lv,
        })

    # Friction patterns
    pats = []
    for pt, desc, det in FRICTION_DETECTORS:
        m = [s for s in sessions if det(s['path'])]
        if m:
            nc = sum(1 for s in m if s['converted'])
            pats.append({
                'type': pt, 'description': desc,
                'sessions_affected': len(m),
                'pct_of_total': round(len(m) / n_sessions * 100, 1),
                'conversion_rate': round(nc / len(m), 4),
            })
    pats.sort(key=lambda x: -x['sessions_affected'])

    print(f"Patterns: {len(pats)} detected")
    for p in pats:
        print(f"  {p['type']}: {p['sessions_affected']} ({p['pct_of_total']}%)")

    # Path mining
    def mine(sl, ms=10):
        pc = Counter(' → '.join(s['path']) for s in sl if len(s['path']) >= 2)
        return [{
            'path': ps.split(' → '), 'path_string': ps, 'count': cnt,
            'support': round(cnt / len(sl), 4),
            'conversion_rate': round(sum(1 for s in sl if s['path'] == ps.split(' → ') and s['converted']) / cnt, 4),
            'avg_events': len(ps.split(' → ')),
        } for ps, cnt in pc.most_common(30) if cnt >= ms]

    ap = mine(sessions)
    cp = mine([s for s in sessions if s['converted']])
    np_ = mine([s for s in sessions if not s['converted']])
    cps = {p['path_string'] for p in cp}
    nps = {p['path_string'] for p in np_}

    # Transition matrix
    def compute_matrix(sl):
        c = defaultdict(lambda: defaultdict(int))
        for s in sl:
            steps = ['[start]'] + s['path'] + ['[exit]']
            for j in range(len(steps) - 1):
                c[steps[j]][steps[j + 1]] += 1
        return {f: {t: round(n / sum(ts.values()), 4) for t, n in ts.items()} for f, ts in c.items()}

    # Markov analytics (activates the transition matrix as a real AI technique)
    all_matrix = compute_matrix(sessions)
    conv_matrix = compute_matrix([s for s in sessions if s['converted']])
    nonconv_matrix = compute_matrix([s for s in sessions if not s['converted']])

    def compute_path_probabilities(matrix):
        """P(reaches purchase | at step X) via value iteration."""
        steps = set()
        for f in matrix:
            steps.add(f)
            for t in matrix[f]:
                steps.add(t)
        prob = {s: 1.0 if s == 'purchase' else (0.0 if s == '[exit]' else 0.5) for s in steps}
        for _ in range(50):
            max_d = 0
            for s in steps:
                if s in ('purchase', '[exit]'):
                    continue
                if s not in matrix:
                    prob[s] = 0
                    continue
                new_p = sum(p * prob.get(nxt, 0) for nxt, p in matrix[s].items())
                max_d = max(max_d, abs(new_p - prob[s]))
                prob[s] = new_p
            if max_d < 1e-6:
                break
        return {s: round(p, 4) for s, p in prob.items() if s not in ('[start]', '[exit]')}

    def compute_divergence(conv_m, nonconv_m):
        """Where do converting vs non-converting paths split?"""
        points = []
        all_from = set(list(conv_m.keys()) + list(nonconv_m.keys()))
        for f in all_from:
            if f in ('[start]', '[exit]'):
                continue
            ct = conv_m.get(f, {})
            nt = nonconv_m.get(f, {})
            for t in set(list(ct.keys()) + list(nt.keys())):
                if t == '[start]':
                    continue
                cp, ncp = ct.get(t, 0), nt.get(t, 0)
                delta = abs(cp - ncp)
                if delta < 0.05:
                    continue
                direction = 'converters_more' if cp > ncp else 'non_converters_more'
                points.append({
                    'from_step': f, 'to_step': t,
                    'converting_prob': round(cp, 4),
                    'non_converting_prob': round(ncp, 4),
                    'delta': round(delta, 4),
                    'direction': direction,
                })
        points.sort(key=lambda x: -x['delta'])
        return points[:15]

    def compute_expected_steps(matrix):
        """Expected steps from each state to purchase."""
        steps = set()
        for f in matrix:
            steps.add(f)
            for t in matrix[f]:
                steps.add(t)
        exp = {s: 0 if s in ('purchase', '[exit]') else 10 for s in steps}
        for _ in range(100):
            max_d = 0
            for s in steps:
                if s in ('purchase', '[exit]'):
                    continue
                if s not in matrix:
                    exp[s] = float('inf')
                    continue
                new_e = 1 + sum(p * min(exp.get(nxt, 100), 100) for nxt, p in matrix[s].items())
                max_d = max(max_d, abs(new_e - exp[s]))
                exp[s] = new_e
            if max_d < 0.001:
                break
        return [
            {'step': s, 'expected_steps_to_purchase': round(e, 1) if e < 50 else None}
            for s, e in sorted(exp.items(), key=lambda x: x[1])
            if s not in ('[start]', '[exit]')
        ]

    markov = {
        'path_probabilities': compute_path_probabilities(all_matrix),
        'divergence_points': compute_divergence(conv_matrix, nonconv_matrix),
        'expected_steps': compute_expected_steps(all_matrix),
    }

    print(f"\nMarkov analytics:")
    pp = markov['path_probabilities']
    for s in ['homepage', 'view', 'add_to_cart', 'checkout']:
        if s in pp:
            print(f"  P(purchase | {s}) = {pp[s]:.1%}")
    print(f"  Divergence points: {len(markov['divergence_points'])}")

    return {
        'metadata': {
            'total_sessions': n_sessions, 'converting_sessions': n_conv,
            'conversion_rate': round(cr, 4), 'avg_events_per_session': round(avg_ev, 1),
            'avg_session_value': round(avg_val, 2), 'data_source': 'synthetic_showcase',
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'n_friction_points': nf,
            'top_friction_step': friction_scores[0]['step'] if friction_scores else None,
        },
        'sankey': {'nodes': nodes, 'links': links},
        'patterns': {
            'all': ap, 'converting': cp, 'non_converting': np_,
            'unique_to_converting': [p for p in cp if p['path_string'] not in nps],
            'unique_to_non_converting': [p for p in np_ if p['path_string'] not in cps],
        },
        'friction': {'scores': friction_scores, 'patterns_detected': pats},
        'transition_matrix': {
            'all': all_matrix, 'converting': conv_matrix, 'non_converting': nonconv_matrix,
        },
        'markov_analytics': markov,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='public/showcase_data.json')
    parser.add_argument('--sessions', type=int, default=10000)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    data = generate_showcase(n_sessions=args.sessions, seed=args.seed)
    os.makedirs(os.path.dirname(args.output) or '.', exist_ok=True)
    with open(args.output, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"\n✅ {args.output} ({os.path.getsize(args.output) / 1024:.1f} KB)")
