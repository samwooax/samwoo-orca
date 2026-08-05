export const HERMES_ACP_REASONING_BRIDGE = `
from acp_adapter.entry import main
from acp_adapter.server import HermesACPAgent
from hermes_constants import parse_reasoning_effort

_original_set_config_option = HermesACPAgent.set_config_option

async def _set_config_option_with_reasoning(self, config_id, session_id, value, **kwargs):
    response = await _original_set_config_option(
        self, config_id=config_id, session_id=session_id, value=value, **kwargs
    )
    if str(config_id) == "reasoning_effort":
        state = self.session_manager.get_session(session_id)
        if state is not None:
            state.agent.reasoning_config = parse_reasoning_effort(value)
    return response

# Why: Hermes 0.20 stores ACP config options but does not apply reasoning_effort to its agent.
HermesACPAgent.set_config_option = _set_config_option_with_reasoning
main()
`.trim()
