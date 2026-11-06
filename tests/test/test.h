#pragma once

#include <iostream>
#include <vector>

namespace te::test
{
struct Case
{
    const char* name;
    const char* file;
    void (*run)();
};
std::vector<Case>& cases();
extern int failures;
struct Registrar
{
    Registrar(const char* name, const char* file, void (*run)());
};
void fail(const char* file, int line, const char* condition);
void skip(const char* reason);
int run(int argc, char** argv);

template<typename A, typename B>
void checkEqual(const A& actual, const B& expected, const char* expression, const char* file, int line)
{
    if (actual == expected) return;
    std::cerr << file << ':' << line << ": CHECK_EQ(" << expression << ") failed: " << actual << " != " << expected << '\n';
    ++failures;
}
}  // namespace te::test

#define TEST(name) \
    static void name(); \
    static const te::test::Registrar name##Registrar(#name, __FILE__, name); \
    static void name()
#define CHECK(condition) ((condition) ? void() : te::test::fail(__FILE__, __LINE__, #condition))
#define CHECK_EQ(actual, expected) te::test::checkEqual((actual), (expected), #actual ", " #expected, __FILE__, __LINE__)
