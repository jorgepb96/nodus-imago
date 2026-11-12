"""Oracle comparisons, separate implementations; no application data or inference."""
import json, sys, warnings, importlib.metadata
import numpy as np
sys.path.insert(0, 'test-results/statistical-reference')
from sklearn.metrics import cohen_kappa_score, jaccard_score, precision_recall_fscore_support
from statsmodels.stats.inter_rater import aggregate_raters, fleiss_kappa
from statsmodels.stats.proportion import proportion_confint
import krippendorff
warnings.filterwarnings('ignore', category=RuntimeWarning)
warnings.filterwarnings('ignore', category=UserWarning)
checks = 0

def compare(actual, expected, context):
    global checks
    if expected is not None and not np.isfinite(expected): expected = None
    assert (actual is None and expected is None) or (actual is not None and expected is not None and abs(actual - expected) < 1e-9), (context, actual, expected)
    checks += 1

def group(case, group):
    indices = [case['ids'].index(i) for i in group['columns']]
    complete_all = [r for r in case['data'] if all(v is not None for v in r)]
    usable = complete_all if case['config']['cohort'] == 'complete' else case['data']
    data = [[r[i] for i in indices] for r in usable]
    complete = [r for r in data if all(v is not None for v in r)]
    if len(indices) < 2: return
    unanimity = sum(all(v == r[0] for v in r) for r in complete)
    compare(group['unanimity']['value'], unanimity / len(complete) if complete else None, 'unanimity')
    if case['config']['mode'] != 'nominal': return
    f = None
    if len(complete) >= 2:
        codes = np.array([[int(v[0]) for v in r] for r in complete])
        table, _ = aggregate_raters(codes, n_cat=case['categories'])
        f = fleiss_kappa(table)
    compare(group['fleiss']['value'], f, 'Fleiss')
    pairable = [r for r in data if sum(v is not None for v in r) >= 2]
    a = None
    if len(pairable) >= 2:
        matrix = np.array([[np.nan if v is None else int(v[0]) for v in r] for r in pairable], dtype=float).T
        try: a = krippendorff.alpha(reliability_data=matrix, level_of_measurement='nominal')
        except ValueError: a = None
    compare(group['alpha']['value'], a, 'Krippendorff alpha')

cases = json.load(sys.stdin)
for case in cases:
    config, report = case['config'], case['report']
    complete_all = [r for r in case['data'] if all(v is not None for v in r)]
    usable = complete_all if config['cohort'] == 'complete' else case['data']
    for p in report['pairs']:
        ia, ib = case['ids'].index(p['a']), case['ids'].index(p['b'])
        rows = [r for r in usable if r[ia] is not None and r[ib] is not None]
        n = len(rows)
        exact = sum(r[ia] == r[ib] for r in rows) if config['mode'] == 'nominal' else sum(set(r[ia]) == set(r[ib]) for r in rows)
        compare(p['exact']['value'], exact / n if n else None, 'pair exact')
        if n:
            lo, hi = proportion_confint(exact, n, alpha=0.05, method='wilson')
            compare(p['exact']['interval'][0], lo, 'Wilson low')
            compare(p['exact']['interval'][1], hi, 'Wilson high')
        if config['mode'] == 'nominal':
            left, right = [r[ia][0] for r in rows], [r[ib][0] for r in rows]
            expected = cohen_kappa_score(left, right) if n >= 2 else None
            compare(p['kappa']['value'], expected, 'Cohen')
            if config['weight'] != 'none':
                expected = cohen_kappa_score(left, right, labels=config['categoryOrder'], weights=config['weight']) if n >= 2 else None
                compare(p['weightedKappa']['value'], expected, 'weighted Cohen')
        elif n:
            left = np.array([[str(c) in r[ia] for c in range(case['categories'])] for r in rows], dtype=int)
            right = np.array([[str(c) in r[ib] for c in range(case['categories'])] for r in rows], dtype=int)
            compare(p['jaccard'], jaccard_score(left, right, average='samples', zero_division=1), 'Jaccard samples')
            observed = np.nonzero((left.sum(axis=0) + right.sum(axis=0)) > 0)[0]
            for category in p['classes']:
                i = int(category['label'])
                expected = cohen_kappa_score(left[:, i], right[:, i]) if n >= 2 else None
                compare(category['kappa']['value'], expected, 'binary Cohen')
                precision, recall, f1, _ = precision_recall_fscore_support(left[:, i], right[:, i], labels=[1], average=None, zero_division=0)
                compare(category['precision'], precision[0] if right[:, i].sum() else None, 'precision')
                compare(category['recall'], recall[0] if left[:, i].sum() else None, 'recall')
                compare(category['f1'], f1[0], 'F1 class')
            if len(observed):
                for average, key in [('micro', 'microF1'), ('macro', 'macroF1')]:
                    _, _, f1, _ = precision_recall_fscore_support(left[:, observed], right[:, observed], average=average, zero_division=0)
                    compare(p[key], f1, 'F1 ' + average)
    group(case, report['models']); group(case, report['all'])
    models = len(case['ids']) - 1
    any_count = sum(any(v == r[-1] for v in r[:-1]) for r in complete_all)
    all_count = sum(all(v == r[-1] for v in r[:-1]) for r in complete_all)
    compare(report['human']['any']['value'], any_count / len(complete_all) if complete_all else None, 'any model versus human')
    compare(report['human']['all']['value'], all_count / len(complete_all) if complete_all else None, 'all models versus human')
print(json.dumps({'cases': len(cases), 'comparisons': checks, 'tolerance': 1e-9, 'seed': 13271112, 'versions': {p: importlib.metadata.version(p) for p in ['numpy', 'scikit-learn', 'statsmodels', 'krippendorff']}, 'passed': True}))
