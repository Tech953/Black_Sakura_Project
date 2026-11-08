"""Shared offline character sessions; native presenters are imported on demand."""
__version__ = "1.0.0"
from .history import HistoryStore
from .characters import CharacterRepository
from .session import ConversationSession

def create_widget(studio, **kwargs):
    from .qt import CompanionWidget
    return CompanionWidget(studio, **kwargs)
