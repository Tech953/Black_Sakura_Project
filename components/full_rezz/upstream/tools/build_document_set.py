"""Render active guides with wrapped tables and readable pagination."""
from pathlib import Path
import re,json,html
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader
R=Path(__file__).resolve().parents[1];A=R/'FULL_REZZ/app';OUT=R.parent;REV='2026-10-14.2'
for font,filename in [('Body','DejaVuSans.ttf'),('BodyBold','DejaVuSans-Bold.ttf'),('Mono','DejaVuSansMono.ttf')]:
 pdfmetrics.registerFont(TTFont(font,'/usr/share/fonts/truetype/dejavu/'+filename))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='BodyBold',italic='Body',boldItalic='BodyBold')
S=getSampleStyleSheet();S.add(ParagraphStyle('BodyGuide',fontName='Body',fontSize=9.6,leading=13.8,spaceAfter=7.5))
S.add(ParagraphStyle('GuideTitle',fontName='BodyBold',fontSize=23,leading=27,textColor=colors.HexColor('#15394a'),spaceAfter=17))
S.add(ParagraphStyle('GuideH2',fontName='BodyBold',fontSize=13,leading=17,textColor=colors.HexColor('#146978'),spaceBefore=13,spaceAfter=7,keepWithNext=True))
S.add(ParagraphStyle('GuideH3',fontName='BodyBold',fontSize=10.5,leading=14,spaceBefore=9,spaceAfter=5,keepWithNext=True))
S.add(ParagraphStyle('GuideTableH2',parent=S['GuideH2'],keepWithNext=False))
S.add(ParagraphStyle('TableGuide',parent=S['BodyGuide'],fontSize=8.2,leading=11,spaceAfter=0))
S.add(ParagraphStyle('CodeGuide',fontName='Mono',fontSize=7.4,leading=10,spaceAfter=8))
S.add(ParagraphStyle('AuditBody',parent=S['BodyGuide'],fontSize=9.4,leading=13.2,spaceAfter=6.3))
def inline(s):
 s=html.escape(s.replace('—','-').replace('–','-').replace('•','-'))
 s=re.sub(r'`([^`]+)`',r'<font name="Mono">\1</font>',s)
 s=re.sub(r'\*\*([^*]+)\*\*',r'<b>\1</b>',s)
 return re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'\1 (\2)',s)
def story(text,audit=False):
 lines=text.splitlines();out=[];i=0
 while i<len(lines):
  line=lines[i].strip()
  if not line:i+=1;continue
  if line.startswith('```'):
   code=[];i+=1
   while i<len(lines) and not lines[i].startswith('```'):code.append(lines[i]);i+=1
   out.append(Paragraph('<br/>'.join(html.escape(x).replace(' ','&#160;') for x in code),S['CodeGuide']));i+=1;continue
  if line.startswith('|'):
   rows=[]
   while i<len(lines) and lines[i].strip().startswith('|'):
    cells=[v.strip() for v in lines[i].strip().strip('|').split('|')]
    if not all(re.fullmatch(r':?-+:?',v.replace(' ','')) for v in cells):rows.append([Paragraph(inline(v),S['TableGuide']) for v in cells])
    i+=1
   n=len(rows[0]);width=A4[0]-88;cols=[width*.34,width*.66] if n==2 else ([width*.10,width*.31,width*.59] if n==3 else [width/n]*n)
   table=Table(rows,colWidths=cols,repeatRows=1,hAlign='LEFT')
   padding=4.8 if audit else 6
   table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e2eef0')),('GRID',(0,0),(-1,-1),.4,colors.HexColor('#bdcfd4')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),padding),('BOTTOMPADDING',(0,0),(-1,-1),padding)]))
   out.extend([table,Spacer(1,9)]);continue
  if line.startswith('# '):out.append(Paragraph(inline(line[2:]),S['GuideTitle']));i+=1;continue
  if line.startswith('## '):
   next_line=next((x.strip() for x in lines[i+1:] if x.strip()),'')
   out.append(Paragraph(inline(line[3:]),S['GuideTableH2'] if next_line.startswith('|') else S['GuideH2']));i+=1;continue
  if line.startswith('### '):out.append(Paragraph(inline(line[4:]),S['GuideH3']));i+=1;continue
  paragraph=[line];i+=1
  while i<len(lines) and lines[i].strip() and not lines[i].lstrip().startswith(('#','|','```','- ')) and not re.match(r'^\d+\. ',lines[i].strip()):paragraph.append(lines[i].strip());i+=1
  out.append(Paragraph(inline(' '.join(paragraph).lstrip('> ')),S['AuditBody'] if audit else S['BodyGuide']))
 return out
def footer(c,doc):
 c.saveState();c.setStrokeColor(colors.HexColor('#cad9dd'));c.line(44,37,A4[0]-44,37);c.setFont('Body',7.3);c.setFillColor(colors.HexColor('#4f626b'));c.drawString(44,25,'FULL_REZZ 3.0 | Delivery '+REV);c.drawRightString(A4[0]-44,25,str(doc.page));c.restoreState()
def main():
 documents=[('User_Guide','User_Guide'),('Quick_Start','Quick_Start'),('Product_Audit','Release_Audit'),('Replit_Integration_Guide','Replit_Integration_Guide')];report=[]
 for output,source in documents:
  text=(A/'docs'/f'{source}.md').read_text();p=OUT/f'FULL_REZZ_3.0_{output}.pdf';doc=SimpleDocTemplate(str(p),pagesize=A4,leftMargin=44,rightMargin=44,topMargin=43,bottomMargin=49,title='FULL_REZZ 3.0 '+output.replace('_',' '),author='FULL_REZZ')
  doc.build(story(text,output=='Product_Audit'),onFirstPage=footer,onLaterPages=footer)
  reader=PdfReader(p);assert reader.pages and all(page.extract_text().strip() for page in reader.pages)
  (A/'docs'/f'{source}.pdf').write_bytes(p.read_bytes());report.append({'file':p.name,'pages':len(reader.pages),'bytes':p.stat().st_size})
 (R/'FULL_REZZ/FULL_REZZ_User_Guide.pdf').write_bytes((OUT/'FULL_REZZ_3.0_User_Guide.pdf').read_bytes())
 (R/'FULL_REZZ/FULL_REZZ_Quick_Start.pdf').write_bytes((OUT/'FULL_REZZ_3.0_Quick_Start.pdf').read_bytes())
 (R/'evidence/rebuild_20261014/document_rendering.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
