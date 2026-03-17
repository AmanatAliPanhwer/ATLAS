import os
from typing import Literal
from tavily import TavilyClient
from deepagents import create_deep_agent
from Database.prompts import research_instructions
import traceback


tavily_client = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])

class Tools:
    def __init__(self):
        pass

    def internet_search(
        self,
        query: str,
        max_results: int = 5,
        topic: Literal["general", "news", "finance"] = "general",
        include_raw_content: bool = False,
    ):
        """Run a web search"""
        print(f"Running internet search for query: {query}")
        print(f"Max results: {max_results}, Topic: {topic}, Include raw content: {include_raw_content}")
        return tavily_client.search(
            query,
            max_results=max_results,
            include_raw_content=include_raw_content,
            topic=topic,
        )


class DeepAgent:
    def __init__(self, session=None):
        self.research_instructions = research_instructions
        self.tools = Tools()
        self.agent = create_deep_agent(
            model="google_genai:gemini-3.1-flash-lite-preview",
            tools=[self.tools.internet_search],
            system_prompt=research_instructions,
        )
        self.session = session

    async def query(self, query: str):
        try:
            result = await self.agent.ainvoke({"messages": [{"role": "user", "content": query}]})
            
            last_message = result["messages"][-1]
            content = last_message.content
            
            # content can be a string or a list of blocks
            if isinstance(content, str):
                return f"Result: {content}"
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        return f"Result: {block['text']}"
            
            return f"Result: {str(content)}"
        
        except Exception as e:
            traceback.print_exc()
            return f"DeepAgent error: {e}"