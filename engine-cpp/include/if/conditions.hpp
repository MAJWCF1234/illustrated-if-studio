#pragma once
#include <nlohmann/json.hpp>
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

inline bool eval_when(const nlohmann::json& when, const State& state) {
  if (when.is_null() || when.empty()) return true;
  if (when.contains("hasAbility")) {
    return state.abilities.count(when.at("hasAbility").get<std::string>()) > 0;
  }
  if (when.contains("not")) return !eval_when(when.at("not"), state);
  if (when.contains("all")) {
    for (const auto& w : when.at("all")) if (!eval_when(w, state)) return false;
    return true;
  }
  if (when.contains("any")) {
    for (const auto& w : when.at("any")) if (eval_when(w, state)) return true;
    return false;
  }
  if (when.contains("var")) {
    const auto key = when.at("var").get<std::string>();
    auto it = state.vars.find(key);
    if (it == state.vars.end()) return false;
    if (when.contains("eq")) return it->second == when.at("eq");
    if (when.contains("gte")) return it->second.get<double>() >= when.at("gte").get<double>();
    if (when.contains("lte")) return it->second.get<double>() <= when.at("lte").get<double>();
    if (when.contains("truthy")) return it->second.get<bool>() == when.at("truthy").get<bool>();
    return true;
  }
  return true;
}

}  // namespace ifs
