import os
import uuid
import datetime
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_chroma import Chroma
from langchain_core.documents import Document

DB_PATH = os.path.join(os.getcwd(), "Database", "RAG_DB")
os.makedirs(DB_PATH, exist_ok=True)

COLLECTION_NAME = "chat_history"

class RAG:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.embeddings = GoogleGenerativeAIEmbeddings(
            model="gemini-embedding-2-preview",
            task_type="RETRIEVAL_DOCUMENT"
        )

        self.query_embeddings = GoogleGenerativeAIEmbeddings(
            model="gemini-embedding-2-preview",
            task_type="RETRIEVAL_QUERY"
        )

        self.vector_store = Chroma(
            collection_name=COLLECTION_NAME,
            embedding_function=self.embeddings,
            persist_directory=DB_PATH
        )
    
    def save_turn(self, role: str, content: str):
        """Save a message to ChromaDB with metadata."""
        if not content or not content.strip():
            return
        
        doc = Document(
            page_content=f"{role.upper()}: {content}",
            metadata={
                "role": role,
                "session_id": self.session_id,
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "doc_id": str(uuid.uuid4())
            }
        )
        self.vector_store.add_documents([doc])
    
    def save_exchange(self, user_text: str, assistant_text: str):
        """Convenience: save both sides of a turn at once."""
        self.save_turn("user", user_text)
        self.save_turn("assistant", assistant_text)
    
    def retrieve_context(self, query: str, k: int = 5) -> str:
        """Retrieve relevant messages from ChromaDB based on a query."""
        if not query or not query.strip():
            return ""
 
        query_vec = self.query_embeddings.embed_query(query)
 
        try:
            results = self.vector_store._collection.query(
                query_embeddings=[query_vec],
                n_results=k,
            )
        except Exception:
            return ""
 
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
 
        if not docs:
            return ""
 
        # Sort by timestamp so context reads chronologically
        paired = sorted(zip(metas, docs), key=lambda x: x[0].get("timestamp", ""))
        lines = [doc for _, doc in paired]
 
        return "\n".join(lines)
    
    def get_recent_turns(self, limit: int = 10) -> list:
        """Get recent messages from ChromaDB for a session (for display)."""
        results = self.vector_store._collection.get(
            where={"session_id": self.session_id},
            include=["documents", "metadatas"],
        )
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        combined = list(zip(metas, docs))
        combined.sort(key=lambda x: x[0].get("timestamp", ""))
        return [
            {"role": m.get("role"), "content": d.split(": ", 1)[-1], "timestamp": m.get("timestamp")}
            for m, d in combined[-limit:]
        ]
    
