#!/usr/bin/env python3
"""Valide l'intégrité du référentiel d'exigences. Ne prétend pas exécuter les tests applicatifs."""
from pathlib import Path
import csv,sys,re,argparse,json
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description='Contrôle de traçabilité UNOA')
p.add_argument('--gate-release',action='store_true',help='Refuse toute exigence obligatoire non VERIFIE avec preuve')
a=p.parse_args()
master=(root/'TDR_UNOA_Cahier_des_Charges_Claude_Code.md').read_text(encoding='utf-8')
with (root/'docs/MATRICE_EXIGENCES.csv').open(encoding='utf-8-sig',newline='') as f: rows=list(csv.DictReader(f))
catalog=json.loads((root/'docs/CATALOGUE_MODULES.json').read_text(encoding='utf-8'))
required={'id','module','priorite','exigence','critere_acceptation','test_ref','statut','preuve','commit'}
errors=[]
if not rows:errors.append('Matrice vide')
if rows and not required<=rows[0].keys():errors.append('Colonnes manquantes '+str(required-set(rows[0])))
ids=set();tests=set()
allowed_status={'NON_DEMARRE','EN_COURS','EN_REVUE','VERIFIE','BLOQUE_EXTERNE'}
for n,r in enumerate(rows,2):
 id_=r.get('id','')
 if not re.fullmatch(r'REQ-[A-Z0-9]+-\d{3}',id_): errors.append(f'Ligne {n} ID invalide : {id_}')
 if id_ in ids:errors.append(f'ID dupliqué : {id_}')
 ids.add(id_)
 if id_ not in master:errors.append(f'Exigence absente du TDR : {id_}')
 t=r.get('test_ref','')
 if t in tests:errors.append(f'Test ID dupliqué : {t}')
 tests.add(t)
 if not r.get('exigence') or not r.get('critere_acceptation'): errors.append(f'Exigence incomplète : {id_}')
 if r.get('statut') not in allowed_status: errors.append(f'Statut invalide : {id_} {r.get("statut")}')
 if a.gate_release and r.get('priorite')=='MUST':
  if r.get('statut')!='VERIFIE': errors.append(f'MUST non vérifiée : {id_}')
  if not r.get('preuve') or not r.get('commit'):errors.append(f'Preuve/commit absent : {id_}')
  if r.get('preuve','').strip().lower() in ('ok','done','todo','n/a','test fictif'):
   errors.append(f'Preuve non probante : {id_}')
expected=set()
for m in catalog['modules']:
 for i in range(1,len(m['features'])+1):expected.add(f"REQ-{m['code']}-{i:03}")
if ids!=expected:errors.append(f'Matrice ≠ catalogue : absents={sorted(expected-ids)} surplus={sorted(ids-expected)}')
if catalog['requirements_count']!=len(rows):errors.append('Nombre de lignes incohérent avec CATALOGUE_MODULES.json')
print('Modules :',len(catalog['modules']))
print('Exigences :',len(rows),'| Vérifiées :',sum(r.get('statut')=='VERIFIE' for r in rows))
print('Statuts :', {s:sum(r.get('statut')==s for r in rows) for s in sorted(allowed_status)})
if errors:
 print('\nECHEC —',len(errors),'erreurs / omissions')
 for item in errors[:40]:print(' -',item)
 if len(errors)>40:print(' ... et',len(errors)-40,'autres')
 sys.exit(1)
print('PASS — intégrité du référentiel', '(gate release franchi)' if a.gate_release else '(tests applicatifs non exécutés)')
