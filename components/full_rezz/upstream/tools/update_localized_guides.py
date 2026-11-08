"""Correct companion help without translating stored source evidence."""
from pathlib import Path
import csv,sys,json
R=Path(__file__).resolve().parents[1];A=R/'FULL_REZZ/app'
translations={
'en':"Language settings are independent. The character companion generates local replies; Automatic asks it to follow the current request's language. Confirm ambiguous language in the host. The voice editor does not translate dialogue. Arabic is right-to-left; JSON, paths, hashes and source evidence stay unchanged.",
'es':'Los idiomas son independientes. El compañero genera respuestas locales; Automático solicita el idioma de la petición actual. Confirme los casos ambiguos en ENGRAM. El editor de voz no traduce diálogos. El árabe va de derecha a izquierda; JSON, rutas, hashes y fuentes no cambian.',
'fr':'Les langues sont indépendantes. Le compagnon génère des réponses locales ; Automatique demande la langue de la requête actuelle. Confirmez les cas ambigus dans ENGRAM. L’éditeur vocal ne traduit pas le dialogue. L’arabe va de droite à gauche ; JSON, chemins, empreintes et sources restent inchangés.',
'de':'Die Spracheinstellungen sind unabhängig. Der Begleiter erzeugt lokale Antworten; Automatisch fordert die Sprache der aktuellen Anfrage an. Bestätigen Sie unklare Fälle in ENGRAM. Der Stimmeneditor übersetzt keine Dialoge. Arabisch läuft rechts nach links; JSON, Pfade, Prüfsummen und Quellen bleiben unverändert.',
'pt':'Os idiomas são independentes. O companheiro gera respostas locais; Automático solicita o idioma do pedido atual. Confirme casos ambíguos no ENGRAM. O editor de voz não traduz diálogos. Árabe usa direita para esquerda; JSON, caminhos, hashes e fontes ficam intactos.',
'it':'Le lingue sono indipendenti. Il personaggio genera risposte locali; Automatico richiede la lingua della domanda corrente. Confermare i casi ambigui in ENGRAM. L’editor vocale non traduce dialoghi. Arabo da destra a sinistra; JSON, percorsi, hash e fonti sono conservati.',
'ru':'Языковые настройки независимы. Компаньон создаёт локальные ответы; автоматический режим запрашивает язык текущего сообщения. Неясные случаи нужно подтвердить в ENGRAM. Редактор голоса не переводит диалог. Арабский отображается справа налево; JSON, пути, хеши и источники сохраняются.',
'ja':'言語設定は独立しています。キャラクターはローカルで返信を生成し、自動設定では現在の質問の言語を使うよう指示します。曖昧な言語はENGRAM側で確認してください。音声エディターは台詞を翻訳しません。アラビア語は右から左で、JSON、パス、ハッシュと証拠は変更しません。',
'ko':'언어 설정은 독립적입니다. 캐릭터는 로컬 응답을 생성하며 자동 설정은 현재 요청의 언어를 사용하도록 지시합니다. 모호한 언어는 ENGRAM에서 확인하세요. 음성 편집기는 대사를 번역하지 않습니다. 아랍어는 오른쪽에서 왼쪽이며 JSON, 경로, 해시와 근거는 유지됩니다.',
'zh-Hans':'语言设置相互独立。角色伙伴生成本地回复；自动模式要求使用当前请求的语言。语言不明确时请在 ENGRAM 中确认。语音编辑器不翻译对话。阿拉伯语从右向左显示；JSON、路径、哈希和来源证据不变。',
'ar':'إعدادات اللغات مستقلة. ينشئ الرفيق ردودًا محلية؛ ويطلب الوضع التلقائي استخدام لغة الطلب الحالي. أكّد اللغة في ENGRAM عند الغموض. محرر الصوت لا يترجم الحوار. العربية من اليمين إلى اليسار، وتبقى JSON والمسارات والبصمات والمصادر دون تغيير.',
'hi':'भाषा सेटिंग स्वतंत्र हैं। चरित्र साथी स्थानीय उत्तर बनाता है; स्वचालित मोड वर्तमान अनुरोध की भाषा उपयोग करने को कहता है। अस्पष्ट भाषा की ENGRAM में पुष्टि करें। वॉइस संपादक संवाद का अनुवाद नहीं करता। अरबी दाएँ से बाएँ है; JSON, पथ, हैश और स्रोत साक्ष्य अपरिवर्तित हैं।'}
def main():
 p=A/'voice_studio/languages.py';s=p.read_text();old=next((line.strip().rstrip(']') for line in s.splitlines() if 'This studio does not generate chat replies or translate dialogue.' in line),None)
 s=s.replace(old,repr(translations['en'])) if old else s;p.write_text(s)
 p=A/'voice_studio/locales/help.tsv'
 with p.open(newline='',encoding='utf-8') as f:reader=csv.DictReader(f,delimiter='\t');fields=reader.fieldnames;rows=list(reader)
 matches=[row for row in rows if 'This studio does not generate chat replies' in row['en']]
 if len(matches)>1:raise ValueError('Duplicate obsolete companion help rows')
 if matches:matches[0].update(translations)
 with p.open('w',newline='',encoding='utf-8') as f:w=csv.DictWriter(f,fieldnames=fields,delimiter='\t',lineterminator='\n');w.writeheader();w.writerows(rows)
 sys.path.insert(0,str(A));from voice_studio.languages import Localizer,LOCALES
 for code in LOCALES:(A/'docs/locales'/f'{code}.md').write_text(Localizer(code).guide(),encoding='utf-8')
 p=A/'docs/Localization_and_Languages.md';s=p.read_text().replace('The voice studio does not generate chat replies, translate dialogue or detect ambiguous language from typed text.','The character companion generates local replies. Automatic asks the model to follow the current request; the host should confirm ambiguous languages. The voice editor does not translate dialogue.').replace('Both engines prepend localized spoken synthetic/noncanon disclosure.','Standalone test generation prepends localized spoken synthetic/noncanon disclosure by default. Companion conversation records its disclosure in the interface and receipts.').replace('source and Replit archives','complete source archive').replace('Current exact outcomes are in audit/localization_ui.json, multilingual_audio.json, native_generation_v3.json and the final Packaging_Checks.json.','The preserved baseline outcomes are in audit/localization_ui.json, multilingual_audio.json and native_generation_v3.json. Current rebuild receipts are under evidence/rebuild_20261014/.')
 p.write_text(s)
 print('Twelve localized guides and companion help updated')
if __name__=='__main__':main()
