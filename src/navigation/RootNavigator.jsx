import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import OnboardingScreen from "../screens/OnboardingScreen";
import BaselineScreen from "../screens/BaselineScreen";
import HomeScreen from "../screens/HomeScreen";
import DayScreen from "../screens/DayScreen";
import CheckInScreen from "../screens/CheckInScreen";

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ title: "LiveGood" }} />
        <Stack.Screen name="Baseline" component={BaselineScreen} options={{ title: "Baseline" }} />
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "This Week" }} />
        <Stack.Screen name="Day" component={DayScreen} options={{ title: "Today" }} />
        <Stack.Screen name="CheckIn" component={CheckInScreen} options={{ title: "Check-in" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
