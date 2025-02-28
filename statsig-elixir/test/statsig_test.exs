defmodule StatsigTest do
  use ExUnit.Case
  doctest Statsig

  test "initialize statsig and check gate" do
    # Initialize Statsig with a test SDK key
    IO.puts("\n=== Starting Statsig Test ===")
    sdk_key = System.get_env("test_api_key")

    if sdk_key == nil do
      IO.puts("This test is for Statsig internal testing")
      :ok
    end

    statsig_options = %StatsigOptions{enable_id_lists: true}
    IO.puts("Initializing with SDK key: #{sdk_key}")
    {:ok, _} = Statsig.start_link(sdk_key, statsig_options)

    # Create a test user
    user = %StatsigUser{
      user_id: "test_user_123",
      email: "test@email.com",
      custom_ids: %{
        "a" => "v"
      }
    }

    Statsig.initialize()

    # Check a feature gate
    IO.puts("\nChecking gate 'test_gate'...")
    check_gate = Statsig.check_gate("test_public", user)
    assert check_gate

    IO.puts("\nGetting feature gate 'test_gate'...")
    feature_gate = Statsig.get_feature_gate("test_public", user)
    assert feature_gate.value
    assert feature_gate.name == "test_public"

    IO.puts("\nGetting dynamic_config 'test_gate'...")
    config = Statsig.get_config("test_custom_config", user)
    assert is_binary(config.value)

    IO.puts("\nGetting a subfield in param value")
    param_value = DynamicConfig.get_param_value(config, "header_text")
    assert param_value == "old user test"
    IO.inspect(config)

    IO.puts("\nGetting experiment")
    experiment = Statsig.get_experiment("test_custom_config", user)
    IO.puts("\nGetting experiment param value")
    param_value = Experiment.get_param_value(experiment, "header_text")
    assert param_value == "old user test"

    IO.puts("\nGetting layer object reference")
    layer = Statsig.get_layer("layer_with_many_params", user)

    IO.puts("\nGetting layer param value")
    a_string_value = Layer.get(layer, "a_string", "default")
    assert a_string_value == "layer"
    an_object_value = Layer.get(layer, "an_object", "default")
    # For complex type, return json serialized object
    assert an_object_value == "{\"value\":\"layer_default\"}"
    IO.inspect(an_object_value)

    default_value = Layer.get(layer, "invalid_param", "default")
    assert default_value == "default"

    IO.puts("\nLog event")
    Statsig.log_event(user, "test_event", "string_value", %{"metadata_1" => "value"})
    result = Statsig.log_event(user, "test_event", 1, %{"metadata_1" => "value"})
    IO.inspect(result)
    Statsig.shutdown()
    # Assert the result is a boolean
    IO.puts("=== Test Complete ===\n")
  end
end
