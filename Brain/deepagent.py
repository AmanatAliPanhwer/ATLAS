import asyncio

from deepagents import create_deep_agent
import traceback
from .subagents import SubAgents
from Database.prompts import deepagent_system_prompt

class DeepAgent:
    def __init__(self, session=None):
        self.system_prompt = deepagent_system_prompt
        self.session = session
        self.subagents = SubAgents()

        self.agent = create_deep_agent(
            model="google_genai:gemini-3.1-flash-lite-preview",
            subagents=self.subagents.get_subagents(),
            system_prompt=self.system_prompt,
        )
    
    async def query(self, query: str):
        try:
            result = await self.agent.ainvoke(
                {"messages": [{"role": "user", "content": query}]}
            )

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

if __name__ == "__main__":
    agent = DeepAgent()
    query = "Open Edge browser and search for Amanat Ali Panhwer."
    result = asyncio.run(agent.query(query))
    print(result)