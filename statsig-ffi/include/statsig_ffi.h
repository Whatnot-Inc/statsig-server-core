typedef int Statsig;
typedef int StatsigOptions;
typedef int StatsigUser;

#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct StatsigRef {
  uintptr_t pointer;
} StatsigRef;

typedef struct StatsigUserRef {
  uintptr_t pointer;
} StatsigUserRef;

const char *statsig_create(const char *sdk_key, const char *options_ref);

void statsig_release(const char *statsig_ref);

void statsig_initialize(const char *statsig_ref, void (*callback)(void));

const char *statsig_get_current_values(struct StatsigRef statsig_ref);

bool statsig_check_gate(struct StatsigRef statsig_ref,
                        struct StatsigUserRef user_ref,
                        const char *gate_name);

const char *statsig_get_experiment(struct StatsigRef statsig_ref,
                                   struct StatsigUserRef user_ref,
                                   const char *experiment_name);

const char *statsig_get_client_init_response(struct StatsigRef statsig_ref,
                                             struct StatsigUserRef user_ref);

uintptr_t statsig_get_client_init_response_buffer(struct StatsigRef statsig_ref,
                                                  struct StatsigUserRef user_ref,
                                                  char *buffer,
                                                  uintptr_t buffer_size);

const char *statsig_options_create(const char *specs_url);

void statsig_options_release(const char *options_ref);

struct StatsigUserRef statsig_user_create(const char *user_id,
                                          const char *custom_ids_json,
                                          const char *email,
                                          const char *ip,
                                          const char *user_agent,
                                          const char *country,
                                          const char *locale,
                                          const char *app_version,
                                          const char *custom_json,
                                          const char *private_attributes_json);

void statsig_user_release(struct StatsigUserRef *user_ref);
