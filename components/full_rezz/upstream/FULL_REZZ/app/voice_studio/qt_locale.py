"""Native UI translation without modifying authored text or stored enum values."""
from PySide6.QtCore import Qt,QLocale,QTranslator,QLibraryInfo
from PySide6.QtGui import QFont,QFontDatabase
from PySide6.QtWidgets import QApplication,QLabel,QPushButton,QCheckBox,QLineEdit,QPlainTextEdit,QComboBox
from .runtime import APP_ROOT
class CatalogTranslator(QTranslator):
 def __init__(self,localizer,parent=None):super().__init__(parent);self.localizer=localizer
 def translate(self,context,source,disambiguation=None,n=-1):
  source=source.replace('&','');return self.localizer.text(source) if source in self.localizer.catalogs[self.localizer.locale] else ''
def apply(window):
 language=window.settings.interface_language;window.localizer.locale=language;t=window.localizer.text;base=window.localizer.catalogs['en'];app=QApplication.instance()
 app.setAttribute(Qt.AA_DontUseNativeDialogs,True);window.setLayoutDirection(Qt.RightToLeft if language=='ar' else Qt.LeftToRight);culture=QLocale('zh_CN' if language=='zh-Hans' else language);QLocale.setDefault(culture);window.setLocale(culture)
 if not getattr(app,'_voice_fonts_loaded',False):
  for file in (APP_ROOT/'fonts').glob('*'):
   if file.suffix.lower() in ('.ttf','.otf','.ttc'):QFontDatabase.addApplicationFont(str(file))
  app._voice_fonts_loaded=True
 window.setFont(QFont({'ar':'Noto Sans Arabic','hi':'Noto Sans Devanagari','ja':'Noto Sans CJK JP','ko':'Noto Sans CJK KR','zh-Hans':'Noto Sans CJK SC'}.get(language,'Segoe UI' if __import__('os').name=='nt' else 'DejaVu Sans'),10))
 for tr in getattr(window,'_qt_translators',[]):app.removeTranslator(tr)
 window._qt_translators=[];toolkit=QTranslator(window)
 if toolkit.load('qtbase_'+{'pt':'pt_BR','zh-Hans':'zh_CN'}.get(language,language),QLibraryInfo.path(QLibraryInfo.TranslationsPath)):app.installTranslator(toolkit);window._qt_translators.append(toolkit)
 custom=CatalogTranslator(window.localizer,window);app.installTranslator(custom);window._qt_translators.append(custom)
 for cls in [QLabel,QPushButton,QCheckBox]:
  for widget in window.findChildren(cls):
   if widget is window.status:continue
   source=widget.property('ui_source')
   if source is None and widget.text() in base:source=widget.text();widget.setProperty('ui_source',source)
   if source:widget.setText(t(source))
   if isinstance(widget,QLabel) and widget is not window.path_label:widget.setWordWrap(True)
 for cls in [QLineEdit,QPlainTextEdit]:
  for widget in window.findChildren(cls):
   source=widget.property('ui_placeholder')
   if source is None and widget.placeholderText() in base:source=widget.placeholderText();widget.setProperty('ui_placeholder',source)
   if source:widget.setPlaceholderText(t(source))
 for combo in window.findChildren(QComboBox):
  combo.blockSignals(True)
  for i in range(combo.count()):
   source=combo.itemData(i,Qt.UserRole+1)
   if source is None and combo.itemText(i) in base:
    source=combo.itemText(i);combo.setItemData(i,source,Qt.UserRole+1)
    if combo.itemData(i) is None:combo.setItemData(i,source)
   if source:combo.setItemText(i,t(source))
  combo.blockSignals(False)
 for i,source in enumerate(window.tab_sources):window.tabs.setTabText(i,t(source))
 window.regions.setHorizontalHeaderLabels([t(s) for s in window.region_headers])
 for w in [window.character,window.cleanup,window.audit_view,window.path_label,window.log]:w.setLayoutDirection(Qt.LeftToRight)
 for i in range(window.generations.count()):
  gid=window.generations.itemData(i);window.generations.setItemText(i,gid+' · '+t(window.renders.get(gid)['status']))
 window.setWindowTitle('FULL_REZZ 3.0 — '+t('Offline'));window.guide_browser.setMarkdown(window.localizer.guide())
 if window.process is None:window.status.setText(t('Ready'))
