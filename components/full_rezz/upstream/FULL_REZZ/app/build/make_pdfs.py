from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate,Paragraph,PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
root=Path(__file__).resolve().parents[1]
for name,file in [('Body','DejaVuSans.ttf'),('Bold','DejaVuSans-Bold.ttf')]:pdfmetrics.registerFont(TTFont(name,'/usr/share/fonts/truetype/dejavu/'+file))
body=ParagraphStyle('body',fontName='Body',fontSize=9.4,leading=14,spaceAfter=9,textColor=HexColor('#23383d'));h1=ParagraphStyle('h1',fontName='Bold',fontSize=25,leading=31,spaceAfter=14,textColor=HexColor('#123340'));h2=ParagraphStyle('h2',fontName='Bold',fontSize=13,leading=18,spaceBefore=12,spaceAfter=7,keepWithNext=True,textColor=HexColor('#087b80'))
def foot(c,d):
 c.saveState();c.setFont('Body',8);c.setFillColor(HexColor('#506c72'));c.drawString(42,817,'VOICE PROFILE STUDIO / OFFLINE WINDOWS EDITION');c.drawString(42,25,'Version 3.0.0 | Verified results and outstanding limits are separate');c.drawRightString(553,25,str(d.page));c.restoreState()
for name in ['User_Guide','Quick_Start','Release_Audit']:
 lines=(root/'docs'/f'{name}.md').read_text().splitlines();story=[];buffer=[]
 def flush():
  if buffer:story.append(Paragraph(escape(' '.join(buffer)),body));buffer.clear()
 for line in lines:
  line=line.replace('–','-').replace('—','-').replace('‑','-')
  if line=='<!-- PAGE BREAK -->':flush();story.append(PageBreak())
  elif line.startswith('# '):flush();story.append(Paragraph(escape(line[2:]),h1))
  elif line.startswith('## '):flush();story.append(Paragraph(escape(line[3:]),h2))
  elif not line.strip():flush()
  else:buffer.append(line)
 flush();doc=SimpleDocTemplate(str(root/'docs'/f'{name}.pdf'),pagesize=(595.2756,841.8898),leftMargin=42,rightMargin=42,topMargin=53,bottomMargin=47);doc.build(story,onFirstPage=foot,onLaterPages=foot);print(name,flush=True)
