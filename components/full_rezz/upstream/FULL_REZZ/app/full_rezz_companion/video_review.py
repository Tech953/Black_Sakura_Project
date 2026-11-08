"""Synchronized native movie comparison with one audible track."""
from pathlib import Path
from PySide6.QtCore import Qt,QUrl
from PySide6.QtWidgets import QWidget,QVBoxLayout,QHBoxLayout,QLabel,QPushButton,QSlider
from PySide6.QtMultimedia import QMediaPlayer,QAudioOutput
from PySide6.QtMultimediaWidgets import QVideoWidget

class VideoReviewWidget(QWidget):
    def __init__(self,root,parent=None):
        super().__init__(parent);layout=QVBoxLayout(self);self.notice=QLabel('Compare original and body-preservation exports. Authored pose changes remain flagged for artistic review.');self.notice.setWordWrap(True);layout.addWidget(self.notice);views=QHBoxLayout();self.players=[]
        for title,name in [('Previous render','Previous_Render.webm'),('Body-preservation review','Body_Preservation_Review.webm')]:
            column=QVBoxLayout();column.addWidget(QLabel(title));video=QVideoWidget();column.addWidget(video,1);views.addLayout(column);player=QMediaPlayer(self);audio=QAudioOutput(self);audio.setVolume(0 if self.players else .6);player.setAudioOutput(audio);player.setVideoOutput(video);path=Path(root)/name
            if path.exists():player.setSource(QUrl.fromLocalFile(str(path.resolve())))
            else:self.notice.setText('Review movies are missing from this checkout. Restore the complete release files.')
            player.errorOccurred.connect(lambda error,message:self.notice.setText('Movie playback error: '+message));self.players.append(player)
        layout.addLayout(views,1);controls=QHBoxLayout();button=QPushButton('Play / pause comparison');button.clicked.connect(self.toggle);controls.addWidget(button);self.slider=QSlider(Qt.Horizontal);self.slider.setRange(0,12000);self.slider.sliderMoved.connect(self.seek);controls.addWidget(self.slider,1);layout.addLayout(controls);self.players[0].positionChanged.connect(self.position);self.players[0].durationChanged.connect(self.slider.setMaximum)
    def toggle(self):
        playing=self.players[0].playbackState()==QMediaPlayer.PlayingState
        for player in self.players:player.pause() if playing else player.play()
    def seek(self,ms):
        for player in self.players:player.setPosition(ms)
    def position(self,ms):
        if not self.slider.isSliderDown():self.slider.setValue(ms)
        if abs(self.players[1].position()-ms)>80:self.players[1].setPosition(ms)
