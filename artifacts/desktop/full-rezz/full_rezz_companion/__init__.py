"""Shared offline character sessions; native presenters are imported on demand."""
__version__ = "1.0.0"

__all__ = ["HistoryStore", "CharacterRepository", "ConversationSession", "create_widget"]

def __getattr__(name):
    if name == "HistoryStore":
        from .history import HistoryStore
        return HistoryStore
    if name == "CharacterRepository":
        from .characters import CharacterRepository
        return CharacterRepository
    if name == "ConversationSession":
        from .session import ConversationSession
        return ConversationSession
    raise AttributeError(name)

def create_widget(studio, **kwargs):
    from .qt import CompanionWidget
    return CompanionWidget(studio, **kwargs)
