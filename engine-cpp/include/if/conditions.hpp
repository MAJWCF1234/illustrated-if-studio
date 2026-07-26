#pragma once
#include <nlohmann/json.hpp>
#include <cstddef>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace ifs {

struct HistoryBeat {
  std::string id;
  std::string choice;
};

struct State {
  std::string playerName{"Traveler"};
  std::unordered_set<std::string> abilities;
  std::unordered_map<std::string, nlohmann::json> vars;
  std::vector<HistoryBeat> history;
  std::string currentScene;
};

namespace detail {

/**
 * JavaScript's Number() over the values a story variable can hold. A false
 * return stands in for NaN: comparisons against NaN are all false, so a
 * variable that was never set, or one holding something like "later", leaves
 * the condition unmet instead of throwing out of the middle of a scene.
 *
 * `value` is null when the variable is absent, which is JS `undefined`.
 */
inline bool as_number(const nlohmann::json* value, double& out) {
  if (!value) return false;
  if (value->is_null()) {
    out = 0.0;  // Number(null) is 0
    return true;
  }
  if (value->is_boolean()) {
    out = value->get<bool>() ? 1.0 : 0.0;
    return true;
  }
  if (value->is_number()) {
    out = value->get<double>();
    return true;
  }
  if (value->is_string()) {
    const std::string text = value->get<std::string>();
    const auto first = text.find_first_not_of(" \t\n\r\f\v");
    if (first == std::string::npos) {
      out = 0.0;  // Number("") and Number("  ") are 0
      return true;
    }
    const auto last = text.find_last_not_of(" \t\n\r\f\v");
    const std::string trimmed = text.substr(first, last - first + 1);
    try {
      std::size_t used = 0;
      const double parsed = std::stod(trimmed, &used);
      if (used != trimmed.size()) return false;  // Number("5abc") is NaN, not 5
      out = parsed;
      return true;
    } catch (...) {
      return false;
    }
  }
  return false;
}

/** JavaScript's Boolean() over the same values. */
inline bool as_truthy(const nlohmann::json* value) {
  if (!value || value->is_null()) return false;
  if (value->is_boolean()) return value->get<bool>();
  if (value->is_number()) {
    const double n = value->get<double>();
    return n != 0.0 && !(n != n);
  }
  if (value->is_string()) return !value->get<std::string>().empty();
  return true;
}

}  // namespace detail

inline bool eval_when(const nlohmann::json& when, const State& state) {
  if (when.is_null() || when.empty()) return true;
  if (when.contains("hasAbility")) {
    const auto& want = when.at("hasAbility");
    if (!want.is_string()) return false;
    return state.abilities.count(want.get<std::string>()) > 0;
  }
  // Checked before not/all/any to match the JS and Python engines.
  if (when.contains("var") && !when.at("var").is_null()) {
    const nlohmann::json* left = nullptr;
    if (when.at("var").is_string()) {
      const auto it = state.vars.find(when.at("var").get<std::string>());
      if (it != state.vars.end()) left = &it->second;
    }
    if (when.contains("eq")) return left ? *left == when.at("eq") : false;
    const bool gte = when.contains("gte");
    if (gte || when.contains("lte")) {
      const nlohmann::json& bound = gte ? when.at("gte") : when.at("lte");
      double lhs = 0.0;
      double rhs = 0.0;
      if (!detail::as_number(left, lhs)) return false;
      if (!detail::as_number(&bound, rhs)) return false;
      return gte ? lhs >= rhs : lhs <= rhs;
    }
    if (when.contains("truthy")) {
      return detail::as_truthy(left) == detail::as_truthy(&when.at("truthy"));
    }
    return left != nullptr && !left->is_null();
  }
  if (when.contains("not")) return !eval_when(when.at("not"), state);
  if (when.contains("all")) {
    if (!when.at("all").is_array()) return true;
    for (const auto& w : when.at("all")) if (!eval_when(w, state)) return false;
    return true;
  }
  if (when.contains("any")) {
    if (!when.at("any").is_array()) return false;
    for (const auto& w : when.at("any")) if (eval_when(w, state)) return true;
    return false;
  }
  return true;
}

}  // namespace ifs
