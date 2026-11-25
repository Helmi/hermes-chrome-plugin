import unittest
from test_lifecycle import load_plugin_module


class RegistrationTest(unittest.TestCase):
    def setUp(self):
        plugin = load_plugin_module()
        self.registered = {}
        class Context:
            def register_tool(inner, **kwargs):
                self.registered[kwargs['name']] = kwargs
        class Auth:
            def is_authorized(inner): return True
            def require_authorized(inner): pass
        class Bridge:
            background_default = True
            def send(inner, action, params, timeout):
                self.sent = (action, params)
                return {}
        plugin.register_all_tools(Context(), Bridge(), Auth())

    def test_schema_is_full_function_envelope(self):
        for name, item in self.registered.items():
            schema = item['schema']
            self.assertEqual(schema['name'], name)
            self.assertTrue(schema['description'])
            self.assertEqual(schema['parameters']['type'], 'object')
            self.assertIn('properties', schema['parameters'])

    def test_tab_background_and_window_options_reach_bridge(self):
        item = self.registered['chrome_tab']
        props = item['schema']['parameters']['properties']
        for key in ('background', 'active', 'windowId'):
            self.assertIn(key, props)
        item['handler']({'action': 'new', 'background': False, 'active': True, 'windowId': 2})
        self.assertEqual(self.sent[0], 'tab.new')
        self.assertEqual(self.sent[1]['foreground'], True)
        self.assertNotIn('background', self.sent[1])
        self.assertEqual(self.sent[1]['windowId'], 2)
        self.assertTrue(self.sent[1]['active'])

if __name__ == '__main__': unittest.main()
